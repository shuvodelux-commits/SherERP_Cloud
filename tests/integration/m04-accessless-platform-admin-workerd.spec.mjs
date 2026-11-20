import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {test} from 'node:test';
import {createTestHarness} from 'wrangler';
import {buildPortableProfiles} from '../../scripts/port-p1-instance.mjs';
import instance from '../fixtures/portable-instance.json' with {type:'json'};

const origin=instance.origins.admin;
const issuer='https://accounts.google.com';
const subject='123456789012345678901';
const clientId='123-fixture.apps.googleusercontent.com';
const setupToken='c'.repeat(64);
const nonce='a'.repeat(43);
const hash=token=>createHash('sha256').update(Buffer.from(token,'hex')).digest('hex');

test('local Workerd/D1: Accessless Admin requires approved setup and real authenticated sessions',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'shererp-m04-accessless-'));
  const configPath=join(directory,'wrangler.json');
  const {admin}=buildPortableProfiles({...instance,adminAuthMode:'google-totp-without-access'});
  const generatedDir=resolve('.wrangler/portable-instance');
  const [control]=admin.d1_databases;
  const config={
    ...admin,
    main:resolve(generatedDir,admin.main),
    vars:{
      ...admin.vars,
      PLATFORM_OPERATOR_GOOGLE_SUBJECT:subject,
      PLATFORM_TOTP_SECRET:'f'.repeat(40),
      PLATFORM_FACTOR_VERSION:'1',
    },
    d1_databases:[{
      ...control,migrations_dir:resolve(generatedDir,control.migrations_dir),
    }],
  };
  await writeFile(configPath,JSON.stringify(config),{mode:0o600});
  const harness=createTestHarness({workers:[{configPath}]});
  try{
    await harness.listen();
    const worker=harness.getWorker(config.name);
    await worker.applyD1Migrations('CONTROL_DB');
    const {CONTROL_DB:db}=await worker.getEnv();
    assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_first_superadmin').first()).n,0);
    const get=(path='/',options={})=>worker.fetch(origin+path,options);
    const post=(path,payload,extraHeaders={})=>get(path,{
      method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...extraHeaders},
      body:JSON.stringify(payload),
    });
    const page=await get('/');
    assert.equal(page.status,200);
    assert.match(await page.text(),/Platform sign-in/);
    assert.equal(page.headers.get('Cache-Control'),'no-store');
    assert.equal((await get('/api/platform/auth/session')).status,403,
      'before enrollment, no ordinary session can exist');
    assert.equal((await post('/api/platform/setup/challenge',{setupToken})).status,403,
      'a random ticket never bootstraps an administrator');

    const now=Date.now();
    await db.prepare('INSERT INTO platform_setup_tickets VALUES (?,?,?,?,?,?,NULL)')
      .bind(hash(setupToken),nonce,issuer,subject,now-1000,now+120000).run();
    const setup=await post('/api/platform/setup/challenge',{setupToken});
    assert.equal(setup.status,200);
    assert.deepEqual(await setup.json(),{clientId,nonce});
    assert.match(setup.headers.get('Set-Cookie'),/HttpOnly/);
    const cookie=setup.headers.get('Set-Cookie').split(';')[0];
    assert.equal((await post('/api/platform/setup',{credential:'forged'},{
      Cookie:cookie,
    })).status,401,'invalid Google signature does not enroll');
    assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_first_superadmin').first()).n,0);

    // Insert synthetic authority in the disposable local database ONLY to
    // probe the runtime boundary. Actual hosted enrollment uses a signed
    // nonce-bound Google credential and the reviewed one-time ticket issuer.
    await db.prepare('INSERT INTO platform_first_superadmin VALUES (1,?,?,?,?)')
      .bind(issuer,subject,hash(setupToken),now).run();
    await db.prepare('INSERT INTO platform_admin_auth VALUES (1,1,1)').run();
    const login=await get('/');
    assert.equal(login.status,200);
    assert.match(await login.text(),/Platform sign-in/);
    const notSignedIn=await get('/api/platform/auth/session',{headers:{
      'CF-Access-Jwt-Assertion':'forged',
      'CF-Access-Authenticated-User-Email':'admin@example.test',
      Cookie:'CF_Authorization=forged',
    }});
    assert.equal(notSignedIn.status,401);
    const challenge=await post('/api/platform/auth/challenge');
    assert.equal(challenge.status,200);
    const payload=await challenge.json();
    assert.equal(payload.clientId,clientId);
    assert.match(payload.nonce,/^[A-Za-z0-9_-]{43}$/);
    const fresh=await db.prepare('SELECT count(*) AS n FROM platform_login_challenges').first();
    assert.equal(fresh.n,1);
    const browserCookie=challenge.headers.get('Set-Cookie').split(';')[0];
    assert.equal((await post('/api/platform/auth/login',{credential:'forged',code:'123456'},{
      Cookie:browserCookie,
    })).status,401);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_admin_sessions').first()).n,0);
    assert.equal((await worker.fetch(instance.origins.owner+'/')).status,403);
    assert.equal((await post('/api/platform/auth/challenge',{},{
      Origin:'https://attacker.example.test',
    })).status,403);
  }finally{
    await harness.close();
    await rm(directory,{recursive:true,force:true});
  }
});
