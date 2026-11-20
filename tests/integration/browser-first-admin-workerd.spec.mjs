import assert from 'node:assert/strict';
import {createHmac,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createTestHarness} from 'wrangler';
import {commitFirstAdminEnrollment} from '../../src/auth/browser-first-admin-enrollment.js';

import {beginBrowserSetup,verifyBrowserSetupGoogle,finishBrowserSetup,readBrowserAdminFactor}
  from '../../src/auth/browser-first-admin-setup.js';
import {validatePlatformSuperAdminSession} from '../../src/auth/platform-superadmin-session.js';

test('browser setup requires the deployment code, verified Gmail and MFA',async t=>{
  const harness=createTestHarness({workers:[{configPath:'./wrangler.m03-exactly-one-test.jsonc'}]});
  try{
    await harness.listen();
    const {DB:db}=await harness.getWorker('shererp-m03-guard-workerd-test').getEnv();
    for(const file of ['0001_platform_bootstrap.sql','0002_platform_sessions.sql','0004_platform_browser_first_factor.sql']){
      const sql=await readFile(new URL('../../staging-migrations/platform-auth/'+file,import.meta.url),'utf8');
      await db.batch(sql.trim().split('-- next statement').map(statement=>db.prepare(statement.trim())));
    }
    const env={CONTROL_DB:db,PLATFORM_BOOTSTRAP_CODE:'a'.repeat(64),
      PLATFORM_FACTOR_ENCRYPTION_KEY:'b'.repeat(64),PLATFORM_CLIENT_ID:'fixture.apps.googleusercontent.com'};
    const email='owner@gmail.com';
    assert.equal(await beginBrowserSetup(env,{email,setupCode:'c'.repeat(64)}),null);
    const started=await beginBrowserSetup(env,{email,setupCode:env.PLATFORM_BOOTSTRAP_CODE});
    const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
    t.mock.method(globalThis,'fetch',async()=>Response.json({keys:[
      {...publicKey.export({format:'jwk'}),kid:'fixture',alg:'RS256'},
    ]}));
    const credential=address=>{
      const now=Math.floor(Date.now()/1000);
      const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
      const body=b64({alg:'RS256',kid:'fixture'})+'.'+b64({
        iss:'https://accounts.google.com',aud:env.PLATFORM_CLIENT_ID,nonce:started.nonce,
        sub:'100000000000000001',email:address,email_verified:true,iat:now-1,exp:now+60,
      });
      return body+'.'+sign('RSA-SHA256',Buffer.from(body),privateKey).toString('base64url');
    };
    assert.equal(await verifyBrowserSetupGoogle(env,started.token,credential('other@gmail.com')),null);
    const {manualKey}=await verifyBrowserSetupGoogle(env,started.token,credential(email));
    assert.match(manualKey,/^[A-Z2-7]{32}$/);
    assert.equal(await readBrowserAdminFactor(env),null);
    const bits=[...manualKey].map(char=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char)
      .toString(2).padStart(5,'0')).join('');
    const raw=Buffer.from(bits.match(/.{8}/g).map(byte=>parseInt(byte,2)));
    const counter=Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
    const signature=createHmac('sha1',raw).update(counter).digest();
    const otp=String((signature.readUInt32BE(signature.at(-1)&15)&0x7fffffff)%1000000).padStart(6,'0');
    assert.equal(await finishBrowserSetup(env,started.token,'invalid'),false);
    const session=await finishBrowserSetup(env,started.token,otp);
    assert.ok(await validatePlatformSuperAdminSession(db,session));
    assert.equal(await readBrowserAdminFactor(env),raw.toString('hex'));
    assert.equal(await beginBrowserSetup(env,{email,setupCode:env.PLATFORM_BOOTSTRAP_CODE}),null);
    assert.equal(await finishBrowserSetup(env,started.token,otp),false);
  }finally{
    await harness.close();
  }
});

test('first Admin and MFA commit together, and competing enrollment cannot replace them',async()=>{
  const harness=createTestHarness({workers:[{configPath:'./wrangler.m03-exactly-one-test.jsonc'}]});
  try{
    await harness.listen();
    const {DB:db}=await harness.getWorker('shererp-m03-guard-workerd-test').getEnv();
    for(const file of ['0001_platform_bootstrap.sql','0002_platform_sessions.sql','0004_platform_browser_first_factor.sql']){
      const sql=await readFile(new URL('../../staging-migrations/platform-auth/'+file,import.meta.url),'utf8');
      await db.batch(sql.trim().split('-- next statement').map(statement=>db.prepare(statement.trim())));
    }
    const enroll=subject=>commitFirstAdminEnrollment(db,{
      subject,
      encryptedSecret:'fixture-ciphertext',
      enrollmentHash:randomBytes(32).toString('hex'),
      nonce:randomBytes(32).toString('base64url'),
    });
    await db.prepare(`CREATE TRIGGER reject_factor BEFORE INSERT ON platform_browser_first_factor
      BEGIN SELECT RAISE(ABORT,'test factor failure'); END`).run();
    await assert.rejects(enroll('100000000000000001'),/test factor failure/);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_first_superadmin').first()).n,0);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_setup_tickets').first()).n,0);
    await db.prepare('DROP TRIGGER reject_factor').run();

    const outcomes=await Promise.all([enroll('100000000000000001'),enroll('100000000000000002')]);
    assert.deepEqual(outcomes.toSorted(),[false,true]);
    const admin=await db.prepare(`SELECT f.subject,a.enabled,a.factor_version
      FROM platform_first_superadmin f JOIN platform_admin_auth a USING(singleton)`).first();
    assert.equal(admin.subject,['100000000000000001','100000000000000002'][outcomes.indexOf(true)]);
    assert.equal(admin.enabled,1);
    assert.equal(admin.factor_version,1);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_setup_tickets').first()).n,1);
  }finally{
    await harness.close();
  }
});
