import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {test} from 'node:test';
import {createTestHarness} from 'wrangler';
import {generateHostedPilotMigrations,composeHostedShopMigrations,
  HOSTED_CONTROL_MIGRATIONS} from '../../scripts/m03-hosted-pilot-migrations.mjs';
import {verifiedPreboundPilot} from '../../src/auth/m03-hosted-prebound-pilot.js';
import {beginFirstOwnerGmailLogin} from '../../src/auth/platform-owner-gmail-login.js';
import {hashOpaqueSessionToken} from '../../src/auth/session-token.js';

const root=resolve('.');
const origin='https://admin.fixture.workers.dev';
const subject='123456789012345678901';
const uuid=()=>crypto.randomUUID();
const sha=value=>createHash('sha256').update(value).digest('hex');

test('hosted prebound Shop reuses Control Center Create, Resume, list and verified Owner Gmail approval',async t=>{
  await mkdir(join(root,'.wrangler'),{recursive:true});
  const directory=await mkdtemp(join(root,'.wrangler','m03-prebound-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const pilot={shopId:uuid(),databaseId:uuid(),databaseMarker:uuid()};
  const source=await composeHostedShopMigrations(pilot);
  assert.equal(source.length,13);
  const generated=await generateHostedPilotMigrations(pilot,directory);
  assert.equal(generated.control.length,13);
  assert.equal(generated.shop.length,13);
  assert.equal(HOSTED_CONTROL_MIGRATIONS.length,13);
  const controlId=uuid();
  const conf={
    name:'shererp-prebound-pilot-local-test',
    main:join(root,'src/auth/m04-accessless-platform-admin-worker.js'),
    compatibility_date:'2026-11-14',
    rules:[{type:'Text',globs:[
      '**/platform-auth/index.html','**/platform-auth/platform-auth.css',
      '**/platform-auth/platform-auth.js'],fallthrough:true}],
    vars:{
      PLATFORM_AUTH_MODE:'google-totp-without-access',
      PLATFORM_AUTH_SCOPE:'private-platform-auth',
      PLATFORM_AUTH_ORIGIN:origin,
      PLATFORM_CLIENT_ID:'123-fixture.apps.googleusercontent.com',
      PLATFORM_OPERATOR_GOOGLE_SUBJECT:subject,
      PLATFORM_TOTP_SECRET:'a'.repeat(40),
      PLATFORM_FACTOR_VERSION:'1',
      PLATFORM_SHOP_RESERVATION_ENABLED:'true',
      PLATFORM_HOSTED_PILOT_ENABLED:'true',
      PLATFORM_SHOP_DIRECTORY_ENABLED:'false',
      PLATFORM_PILOT_SHOP_ID:pilot.shopId,
      PLATFORM_PILOT_D1_ID:pilot.databaseId,
      PLATFORM_PILOT_MARKER:pilot.databaseMarker
    },
    d1_databases:[
      {binding:'CONTROL_DB',database_name:'control-db',database_id:controlId,
        migrations_dir:join(directory,'control')},
      {binding:'PLATFORM_PILOT_DB',database_name:'pilot-db',database_id:pilot.databaseId,
        migrations_dir:join(directory,'shop')}
    ],
    ratelimits:[{name:'PLATFORM_INGRESS',namespace_id:'53576',
      simple:{limit:100,period:60}}]
  };
  const configPath=join(directory,'worker.json');
  await writeFile(configPath,JSON.stringify(conf),{mode:0o600});
  const harness=createTestHarness({workers:[{configPath}]});
  t.after(()=>harness.close());
  await harness.listen();
  const worker=harness.getWorker(conf.name);
  await worker.applyD1Migrations('CONTROL_DB');
  await worker.applyD1Migrations('PLATFORM_PILOT_DB');
  const env=await worker.getEnv();
  const db=env.CONTROL_DB;
  const shopDb=env.PLATFORM_PILOT_DB;
  assert.equal(await shopDb.prepare('SELECT shop_id FROM shop_identity').first('shop_id'),pilot.shopId);
  assert.ok(await verifiedPreboundPilot({...env,...conf.vars}));
  assert.equal(await verifiedPreboundPilot({...env,...conf.vars,PLATFORM_PILOT_MARKER:uuid()}),null);

  // Synthetically enroll an Admin only in isolated Workerd D1. The hosted
  // installation uses the REAL reviewed Google+TOTP wizard, not these rows.
  const session='1'.repeat(64);
  const now=Date.now();
  const ticketHash=sha('fixture-internal-ticket');
  const challengeHash='c'.repeat(64);
  await db.batch([
    db.prepare('INSERT INTO platform_setup_tickets VALUES (?,?,?,?,?,?,NULL)')
      .bind(ticketHash,'b'.repeat(43),'https://accounts.google.com',subject,now-1000,now+60000),
    db.prepare('INSERT INTO platform_first_superadmin VALUES (1,?,?,?,?)')
      .bind('https://accounts.google.com',subject,ticketHash,now-500),
    db.prepare('INSERT INTO platform_admin_auth VALUES (1,1,1)'),
    db.prepare('INSERT INTO platform_login_challenges VALUES (?,?,?)')
      .bind(challengeHash,'d'.repeat(43),now+60000),
    db.prepare('INSERT INTO platform_login_attempts VALUES (?,?)').bind(challengeHash,now-200),
    db.prepare(`INSERT INTO platform_admin_sessions
      (token_hash,binding_hash,singleton,factor_version,otp_step,issued_at_ms,expires_at_ms)
      VALUES (?,?,1,1,1,?,?)`).bind(await hashOpaqueSessionToken(session),challengeHash,now-100,now+60000)
  ]);
  const get=(path,token=session)=>worker.fetch(origin+'/api/platform'+path,
    {headers:{Cookie:'__Host-shererp-platform-session='+token}});
  const post=(path,body,token=session)=>worker.fetch(origin+'/api/platform'+path,{
    method:'POST',headers:{Origin:origin,'Content-Type':'application/json',
      Cookie:'__Host-shererp-platform-session='+token},
    body:JSON.stringify(body)
  });
  const auth=await get('/auth/session');
  assert.equal(auth.status,200);
  const sessionBody=await auth.json();
  assert.equal(sessionBody.localProvisioningEnabled,true);
  assert.equal(sessionBody.shopDirectoryEnabled,true);
  assert.equal(sessionBody.shopReservationEnabled,true);

  const operationId=uuid();
  const form={operationId,displayName:'Test Hardware Shop',ownerEmail:'first.owner@gmail.com'};
  assert.equal((await post('/shops',{...form,ownerEmail:'not-gmail@example.com'})).status,400);
  assert.equal((await post('/shops',form,'0'.repeat(64))).status,401);
  const create=await post('/shops',form);
  assert.equal(create.status,202);
  const initial=await create.json();
  assert.equal(initial.shopId,pilot.shopId);
  assert.equal(initial.status,'reserved');
  assert.equal((await post('/shops',form)).status,200);
  assert.equal((await post('/shops',{...form,ownerEmail:'other@gmail.com'})).status,409);
  assert.equal((await post('/shops',{...form,operationId:uuid()})).status,409,
    'one static Shop D1 must not be allocated twice');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_owner_gmail_approvals').first()).n,0,
    'Owner is never approved at mere reservation');
  const resumed=await post('/shops/resume',{operationId});
  assert.equal(resumed.status,200);
  const ready=await resumed.json();
  assert.equal(ready.status,'ready');
  assert.equal(ready.shopId,pilot.shopId);
  assert.equal((await post('/shops/resume',{operationId})).status,200);
  const roster=await get('/shops/list');
  assert.equal(roster.status,200);
  const shops=(await roster.json()).shops;
  assert.equal(shops.length,1);
  assert.equal(shops[0].ownerEmail,form.ownerEmail);
  assert.equal(shops[0].status,'ready');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_shop_bindings').first()).n,1);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_owner_gmail_approvals').first()).n,1);
  const firstOwnerChallenge=await beginFirstOwnerGmailLogin({
    ...env,...conf.vars,
    PLATFORM_PILOT_DB:shopDb,CONTROL_DB:db,
    PLATFORM_OWNER_CLIENT_ID:conf.vars.PLATFORM_CLIENT_ID
  });
  assert.match(firstOwnerChallenge?.nonce??'',/^[A-Za-z0-9_-]{43}$/);
});
