import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {createTestHarness} from 'wrangler';
import {resolveAccessAdministrator} from '../../src/auth/m04-access-admin-identity.js';

const audience='a'.repeat(64);
const email='admin@example.test';
const principal={aud:audience,getIdentity:async()=>({email})};
const harness=createTestHarness({workers:[{configPath:'./wrangler.m04-auth-http-test.jsonc'}]});
let env;
before(async()=>{
  await harness.listen();
  const worker=harness.getWorker('shererp-m04-auth-http-local-only');
  await worker.applyD1Migrations('DB');
  const {DB}=await worker.getEnv();
  env={DB,M04_ACCESS_AUDIENCE:audience,M04_ACCESS_ADMIN_EMAIL:email,
    M04_ACCESS_ADMIN_USER_ID:'USR-LOCAL-ADMIN'};
  const insert=DB.prepare(`INSERT INTO auth_users
    (user_id,full_name,phone_key,role_name,status,credential_state,
     password_hash,password_salt,password_iterations) VALUES (?,?,?,'Administrator',?,'LegacyPending',?,?,210000)`);
  await DB.batch([
    insert.bind('USR-LOCAL-ADMIN','Synthetic Administrator','01710000901','Active','a'.repeat(64),'b'.repeat(48)),
    insert.bind('USR-LOCAL-DISABLED','Synthetic Disabled','01710000902','Inactive','a'.repeat(64),'b'.repeat(48)),
  ]);
});
after(()=>harness.close());

test('platform-authenticated email resolves the mapped active Administrator without converting a credential',async()=>{
  assert.deepEqual(await resolveAccessAdministrator({access:principal},env),
    {id:'USR-LOCAL-ADMIN',name:'Synthetic Administrator',role:'Administrator'});
  assert.equal(await env.DB.prepare(
    "SELECT credential_state FROM auth_users WHERE user_id='USR-LOCAL-ADMIN'"
  ).first('credential_state'),'LegacyPending');
  assert.equal(await env.DB.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first('n'),0);
});

test('missing platform Access context, wrong audience, wrong email, and inactive mapped ID fail closed',async()=>{
  assert.equal(await resolveAccessAdministrator({headers:new Headers({
    'Cf-Access-Authenticated-User-Email':email,
  })},env),null);
  assert.equal(await resolveAccessAdministrator({access:{...principal,aud:'b'.repeat(64)}},env),null);
  assert.equal(await resolveAccessAdministrator({access:{...principal,
    getIdentity:async()=>({email:'other@example.test'})}},env),null);
  assert.equal(await resolveAccessAdministrator({access:principal},{
    ...env,M04_ACCESS_ADMIN_USER_ID:'USR-LOCAL-DISABLED',
  }),null);
});
