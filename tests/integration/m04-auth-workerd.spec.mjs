import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createM04SourcePosActionProbe} from '../fixtures/m04-source-pos-action-probe.mjs';
import {createM04RealAuthCashProbe} from '../fixtures/m04-real-auth-cash-probe.mjs';
import {createTestHarness} from 'wrangler';
import {createOfflinePasswordCredential,loginWithD1,validateSessionWithD1} from '../../src/auth/d1-auth-core.js';
import {authorizeStaffReadWithD1} from '../../src/auth/d1-staff-read-gate.js';
import {hashOpaqueSessionToken} from '../../src/auth/session-token.js';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m04-auth-test.jsonc'}]});
const worker=harness.getWorker('shererp-m04-auth-workerd-local-only');
const BASE=1_800_000_000_000;
const PASSWORD='NotARealPassword!2026';
let DB;

async function seed(id,phone,role='Administrator',status='Active'){
  const c=await createOfflinePasswordCredential(PASSWORD);
  await DB.prepare(`INSERT INTO auth_users
    (user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations)
    VALUES (?,?,?,?,?,?,?,?)`).bind(id,'Synthetic '+id,phone,role,status,c.passwordHash,c.passwordSalt,c.iterations).run();
}

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  await DB.prepare("INSERT INTO auth_roles (role_name,status,permissions_json) VALUES ('Cashier','Active','{}'),('Suspended','Inactive','{}')").run();
  await seed('USR-ADMIN','01710000001');
  await seed('USR-ACTIVE','01710000002','Cashier');
  await seed('USR-DISABLED','01710000003','Cashier','Inactive');
  await seed('USR-ROLE-OFF','01710000004','Suspended');
  await seed('USR-BRUTE','01710000005','Cashier');
  await seed('USR-CAS','01710000008');
});
after(async()=>{await harness.close();});

async function rpc(route,body) {
  const response=await worker.fetch('http://m04-auth.local/__m04_test__/'+route,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
  });
  return {status:response.status,body:await response.json()};
}

test('real Workerd+D1 issues random opaque tokens and persists only SHA-256 fingerprints',async()=>{
  const a=await rpc('login',{phoneKey:'01710000001',password:PASSWORD,nowMs:BASE});
  const b=await rpc('login',{phoneKey:'01710000001',password:PASSWORD,nowMs:BASE+1});
  assert.equal(a.status,200);
  assert.equal(a.body.authenticated,true);
  assert.match(a.body.token,/^[a-f0-9]{64}$/);
  assert.deepEqual(a.body.user,{id:'USR-ADMIN',name:'Synthetic USR-ADMIN',role:'Administrator'});
  assert.notEqual(a.body.token,b.body.token);
  const digest=createHash('sha256').update(Buffer.from(a.body.token,'hex')).digest('hex');
  const persisted=await DB.prepare('SELECT token_hash,user_id,expires_at_ms FROM auth_sessions WHERE token_hash=?').bind(digest).first();
  assert.equal(persisted.token_hash,digest);
  assert.equal(await hashOpaqueSessionToken(a.body.token),persisted.token_hash);
  assert.notEqual(createHash('sha256').update(a.body.token,'utf8').digest('hex'),persisted.token_hash);
  assert.equal(persisted.user_id,'USR-ADMIN');
  assert.equal(persisted.expires_at_ms,BASE+12*60*60*1000);
  assert.equal(await DB.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE token_hash=?').bind(a.body.token).first().then(r=>r.n),0);
});

test('session validate and revoke are D1-backed, timestamp-bound and idempotent',async()=>{
  const login=await rpc('login',{phoneKey:'01710000002',password:PASSWORD,nowMs:BASE});
  assert.equal(login.body.authenticated,true);
  const token=login.body.token;
  const session=await rpc('validate',{token,nowMs:BASE+60_000});
  assert.deepEqual(session,{status:200,body:{authenticated:true,user:{id:'USR-ACTIVE',name:'Synthetic USR-ACTIVE',role:'Cashier'}}});
  assert.deepEqual(await rpc('logout',{token,nowMs:BASE+61_000}),{status:200,body:{revoked:true}});
  assert.deepEqual(await rpc('logout',{token,nowMs:BASE+62_000}),{status:200,body:{revoked:true}});
  assert.deepEqual(await rpc('validate',{token,nowMs:BASE+63_000}),{status:200,body:{authenticated:false}});
  assert.deepEqual(await rpc('validate',{token:'garbage',nowMs:BASE+63_000}),{status:200,body:{authenticated:false}});
});

test('invalid credentials, disabled users and inactive custom roles fail identically',async()=>{
  for(const [phone,password] of [
    ['01710000003',PASSWORD],['01710000004',PASSWORD],
    ['01710000006',PASSWORD],['01710000007','wrong'],
    ['01710000001','wrong'],
  ]){
    const out=await rpc('login',{phoneKey:phone,password,nowMs:BASE});
    assert.deepEqual(out,{status:200,body:{authenticated:false}});
  }
});

test('five concurrent failed attempts atomically lock a staff phone for 15 minutes',async()=>{
  const attempts=await Promise.all(Array.from({length:5},()=>rpc('login',{
    phoneKey:'01710000005',password:'bad',nowMs:BASE+10_000,
  })));
  assert.ok(attempts.every(r=>r.status===200 && r.body.authenticated===false));
  const row=await DB.prepare('SELECT failure_count,locked_until_ms FROM auth_login_throttle WHERE login_hash=?')
    .bind(createHash('sha256').update('01710000005').digest('hex')).first();
  assert.equal(row.failure_count,5);
  assert.equal(row.locked_until_ms,BASE+10_000+15*60_000);
  assert.deepEqual(await rpc('login',{phoneKey:'01710000005',password:PASSWORD,nowMs:BASE+11_000}),
    {status:200,body:{authenticated:false}});
  const after=await rpc('login',{phoneKey:'01710000005',password:PASSWORD,nowMs:BASE+10_000+15*60_000});
  assert.equal(after.body.authenticated,true);
});

test('account deactivation and role disabling immediately invalidate previously valid sessions',async()=>{
  const a=await rpc('login',{phoneKey:'01710000001',password:PASSWORD,nowMs:BASE+70_000});
  const b=await rpc('login',{phoneKey:'01710000002',password:PASSWORD,nowMs:BASE+70_000});
  assert.equal(a.body.authenticated,true);
  assert.equal(b.body.authenticated,true);
  await DB.prepare("UPDATE auth_users SET status='Inactive' WHERE user_id='USR-ACTIVE'").run();
  assert.deepEqual(await rpc('validate',{token:b.body.token,nowMs:BASE+80_000}),
    {status:200,body:{authenticated:false}});
  await DB.prepare("UPDATE auth_roles SET status='Inactive' WHERE role_name='Cashier'").run();
  assert.deepEqual(await rpc('login',{phoneKey:'01710000005',password:PASSWORD,nowMs:BASE+100_000}),
    {status:200,body:{authenticated:false}});
  // Built-in Administrator ignores custom role status and remains available.
  assert.equal((await rpc('validate',{token:a.body.token,nowMs:BASE+80_000})).body.authenticated,true);
});

test('session absolute lifetime and idle lifetime expire without a cached actor',async()=>{
  const a=await rpc('login',{phoneKey:'01710000001',password:PASSWORD,nowMs:BASE+200_000});
  assert.equal(a.body.authenticated,true);
  assert.deepEqual(await rpc('validate',{token:a.body.token,nowMs:BASE+200_000+30*60_000}),
    {status:200,body:{authenticated:false}});
  const b=await rpc('login',{phoneKey:'01710000001',password:PASSWORD,nowMs:BASE+200_000});
  assert.equal(b.body.authenticated,true);
  assert.deepEqual(await rpc('validate',{token:b.body.token,nowMs:BASE+200_000+12*60*60_000}),
    {status:200,body:{authenticated:false}});
});

test('unconfigured/malformed login input never bypasses auth checks',async()=>{
  for(const x of [
    {phoneKey:'01710000001',password:'',nowMs:BASE},
    {phoneKey:'bad',password:PASSWORD,nowMs:BASE},
    {phoneKey:'01710000001',password:PASSWORD,nowMs:'yesterday'},
  ]){
    const v=await rpc('login',x);
    assert.equal(v.status,200);
    assert.deepEqual(v.body,{authenticated:false});
  }
  const raw=await worker.fetch('http://m04-auth.local/__m04_test__/admin-backdoor',{method:'POST'});
  assert.equal(raw.status,404);
});


test('a password reset after verification cannot create a stale-credential session',async()=>{
  // Intercept only the session insert boundary to simulate a concurrent,
  // owner-authorized password reset occurring after PBKDF2 verification.
  const db={prepare(sql){
    const stmt=DB.prepare(sql);
    if(!/INSERT INTO auth_sessions/.test(sql)) return stmt;
    return {bind(...args){const bound=stmt.bind(...args);return {async run(){
      await DB.prepare("UPDATE auth_users SET password_hash=?,credential_version=credential_version+1 WHERE user_id='USR-CAS'")
        .bind('ab'.repeat(32)).run();
      return bound.run();
    }}}};
  }};
  const result=await loginWithD1(db,{phoneKey:'01710000008',password:PASSWORD,nowMs:BASE+100_000});
  assert.deepEqual(result,{authenticated:false});
  const sessions=await DB.prepare("SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id='USR-CAS'").first();
  assert.equal(sessions.n,0);
});


test('revocation is write-once in real D1 and a logged-out bearer cannot be resurrected',async()=>{
  const now=BASE+500_000;
  const signed=await rpc('login',{phoneKey:'01710000001',password:PASSWORD,nowMs:now});
  assert.equal(signed.body.authenticated,true);
  const token=signed.body.token;
  const tokenHash=createHash('sha256').update(Buffer.from(token,'hex')).digest('hex');
  assert.deepEqual(await rpc('logout',{token,nowMs:now+1000}),{status:200,body:{revoked:true}});
  assert.deepEqual(await rpc('validate',{token,nowMs:now+2000}),{status:200,body:{authenticated:false}});
  try {
    await assert.rejects(()=>DB.prepare('UPDATE auth_sessions SET revoked_at_ms=NULL WHERE token_hash=?')
      .bind(tokenHash).run(),/revocation|immutable|constraint/i);
  } finally {
    // RED proof may allow unrevocation; restore synthetic fixture before next test.
    const current=await DB.prepare('SELECT revoked_at_ms FROM auth_sessions WHERE token_hash=?')
      .bind(tokenHash).first();
    if(current?.revoked_at_ms===null)
      await DB.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?')
        .bind(now+1000,tokenHash).run();
  }
  assert.deepEqual(await rpc('validate',{token,nowMs:now+3000}),{status:200,body:{authenticated:false}});
});

test('a session cannot be reassigned to a second active Administrator with matching epochs',async()=>{
  const now=BASE+600_000;
  await seed('USR-SEAL-SECOND','01710000009','Administrator');
  const signed=await rpc('login',{phoneKey:'01710000001',password:PASSWORD,nowMs:now});
  assert.equal(signed.body.authenticated,true);
  const tokenHash=createHash('sha256').update(Buffer.from(signed.body.token,'hex')).digest('hex');
  const snapshots=await DB.prepare('SELECT u.user_id,u.auth_version,u.credential_version FROM auth_users u WHERE u.user_id IN (?,?)')
    .bind('USR-ADMIN','USR-SEAL-SECOND').all();
  assert.equal(snapshots.results.length,2);
  assert.equal(snapshots.results[0].auth_version,snapshots.results[1].auth_version);
  assert.equal(snapshots.results[0].credential_version,snapshots.results[1].credential_version);
  try {
    await assert.rejects(()=>DB.prepare('UPDATE auth_sessions SET user_id=? WHERE token_hash=?')
      .bind('USR-SEAL-SECOND',tokenHash).run(),/session|immutable|constraint/i);
  } finally {
    const row=await DB.prepare('SELECT user_id FROM auth_sessions WHERE token_hash=?')
      .bind(tokenHash).first();
    if(row?.user_id!=='USR-ADMIN')
      await DB.prepare('UPDATE auth_sessions SET user_id=? WHERE token_hash=?')
        .bind('USR-ADMIN',tokenHash).run();
  }
  const session=await rpc('validate',{token:signed.body.token,nowMs:now+1000});
  assert.equal(session.body.authenticated,true);
  assert.equal(session.body.user.id,'USR-ADMIN');
});

test('session absolute expiry cannot be extended by SQL after issuance',async()=>{
  const now=BASE+700_000;
  const signed=await rpc('login',{phoneKey:'01710000001',password:PASSWORD,nowMs:now});
  assert.equal(signed.body.authenticated,true);
  const tokenHash=createHash('sha256').update(Buffer.from(signed.body.token,'hex')).digest('hex');
  const oldRow=await DB.prepare('SELECT expires_at_ms FROM auth_sessions WHERE token_hash=?')
    .bind(tokenHash).first();
  assert.equal(oldRow.expires_at_ms,now+12*60*60*1000);
  try {
    await assert.rejects(()=>DB.prepare('UPDATE auth_sessions SET expires_at_ms=? WHERE token_hash=?')
      .bind(oldRow.expires_at_ms+60_000,tokenHash).run(),/session|immutable|constraint/i);
  } finally {
    const row=await DB.prepare('SELECT expires_at_ms FROM auth_sessions WHERE token_hash=?')
      .bind(tokenHash).first();
    if(row?.expires_at_ms!==oldRow.expires_at_ms)
      await DB.prepare('UPDATE auth_sessions SET expires_at_ms=? WHERE token_hash=?')
        .bind(oldRow.expires_at_ms,tokenHash).run();
  }
  assert.equal((await DB.prepare('SELECT expires_at_ms FROM auth_sessions WHERE token_hash=?')
    .bind(tokenHash).first()).expires_at_ms,oldRow.expires_at_ms);
  assert.equal((await rpc('validate',{token:signed.body.token,nowMs:now+1000})).body.authenticated,true);
  assert.equal((await rpc('validate',{token:signed.body.token,nowMs:oldRow.expires_at_ms})).body.authenticated,false);
});


test('a revoked session fingerprint cannot be resurrected by SQLite INSERT OR REPLACE',async()=>{
  const now=BASE+800_000;
  const signed=await rpc('login',{phoneKey:'01710000001',password:PASSWORD,nowMs:now});
  assert.equal(signed.body.authenticated,true);
  const tokenHash=createHash('sha256').update(Buffer.from(signed.body.token,'hex')).digest('hex');
  assert.deepEqual(await rpc('logout',{token:signed.body.token,nowMs:now+1000}),
    {status:200,body:{revoked:true}});
  const original=await DB.prepare('SELECT * FROM auth_sessions WHERE token_hash=?')
    .bind(tokenHash).first();
  assert.equal(original.revoked_at_ms,now+1000);
  try {
    await assert.rejects(()=>DB.prepare(`INSERT OR REPLACE INTO auth_sessions
      (token_hash,user_id,user_auth_version,role_auth_version,credential_version,
       created_at_ms,last_activity_at_ms,expires_at_ms,revoked_at_ms)
      VALUES (?,?,?,?,?,?,?,?,NULL)`)
      .bind(original.token_hash,original.user_id,original.user_auth_version,
        original.role_auth_version,original.credential_version,original.created_at_ms,
        original.last_activity_at_ms,original.expires_at_ms).run(),
      /session|replacement|replace|constraint|abort/i);
  } finally {
    // In RED the attack can succeed; restore the revoked synthetic test row.
    const current=await DB.prepare('SELECT revoked_at_ms FROM auth_sessions WHERE token_hash=?')
      .bind(tokenHash).first();
    if(current?.revoked_at_ms===null)
      await DB.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?')
        .bind(original.revoked_at_ms,tokenHash).run();
  }
  const after=await DB.prepare('SELECT revoked_at_ms,user_id,expires_at_ms FROM auth_sessions WHERE token_hash=?')
    .bind(tokenHash).first();
  assert.equal(after.revoked_at_ms,original.revoked_at_ms);
  assert.equal(after.user_id,original.user_id);
  assert.equal(after.expires_at_ms,original.expires_at_ms);
  assert.deepEqual(await rpc('validate',{token:signed.body.token,nowMs:now+2000}),
    {status:200,body:{authenticated:false}});
});


test('physical DELETE cannot erase issued active or revoked session fingerprints',async()=>{
  for(const [offset,revoke] of [[900_000,true],[920_000,false]]){
    const now=BASE+offset;
    const issued=await rpc('login',{phoneKey:'01710000001',password:PASSWORD,nowMs:now});
    assert.equal(issued.body.authenticated,true);
    const token=issued.body.token;
    const hash=createHash('sha256').update(Buffer.from(token,'hex')).digest('hex');
    if(revoke)
      assert.deepEqual(await rpc('logout',{token,nowMs:now+1000}),
        {status:200,body:{revoked:true}});
    const original=await DB.prepare('SELECT * FROM auth_sessions WHERE token_hash=?')
      .bind(hash).first();
    assert.equal(original.revoked_at_ms===null,!revoke);
    try{
      await assert.rejects(
        ()=>DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(hash).run(),
        /session|delet|immutable|forbidden|abort/i
      );
    }finally{
      // In the RED phase SQLite permits this delete. Restore only our
      // isolated synthetic row so other Workerd fixtures stay unchanged.
      const existing=await DB.prepare('SELECT token_hash FROM auth_sessions WHERE token_hash=?')
        .bind(hash).first();
      if(!existing)
        await DB.prepare(`INSERT INTO auth_sessions (
          token_hash,user_id,user_auth_version,role_auth_version,credential_version,
          created_at_ms,last_activity_at_ms,expires_at_ms,revoked_at_ms
        ) VALUES (?,?,?,?,?,?,?,?,?)`).bind(
          original.token_hash,original.user_id,original.user_auth_version,
          original.role_auth_version,original.credential_version,
          original.created_at_ms,original.last_activity_at_ms,
          original.expires_at_ms,original.revoked_at_ms
        ).run();
    }
    const after=await DB.prepare('SELECT * FROM auth_sessions WHERE token_hash=?')
      .bind(hash).first();
    assert.deepEqual(after,original);
    const checked=await rpc('validate',{token,nowMs:now+2000});
    assert.equal(checked.body.authenticated,!revoke);
  }
});

test('M04 staff read refuses a D1 role whose source visible modules contradict view rights',async()=>{
  const now=BASE+1_100_000;
  // The frozen source derives Allowed Modules from permissions[*].view=true.
  // A contradictory row must never authorize users bootstrap independently
  // of the login profile's existing source-role integrity check.
  const permissions=JSON.stringify({
    users:{view:true,add:false,edit:false,delete:false},
    sales:{view:true,add:false,edit:false,delete:'disabled'},
  });
  await DB.prepare(`INSERT INTO auth_roles
    (role_name,status,permissions_json,allowed_modules)
    VALUES ('M04ReadDrift','Active',?,'sales'),
           ('M04ReadConsistent','Active',?,'users,sales')`)
    .bind(permissions,permissions).run();
  await seed('USR-M04-READ-DRIFT','01710000010','M04ReadDrift');
  await seed('USR-M04-READ-CONSISTENT','01710000011','M04ReadConsistent');
  const drift=await rpc('login',{
    phoneKey:'01710000010',password:PASSWORD,nowMs:now
  });
  assert.equal(drift.body.authenticated,true);
  const inconsistent=await authorizeStaffReadWithD1(DB,{
    token:drift.body.token,methodName:'getUsersBootstrap',nowMs:now+1000
  });
  assert.deepEqual(inconsistent,{authorized:false},
    'source-inconsistent role must not authorize a staff bootstrap read');

  const valid=await rpc('login',{
    phoneKey:'01710000011',password:PASSWORD,nowMs:now
  });
  assert.equal(valid.body.authenticated,true);
  const consistent=await authorizeStaffReadWithD1(DB,{
    token:valid.body.token,methodName:'getUsersBootstrap',nowMs:now+1000
  });
  assert.deepEqual(consistent,{
    authorized:true,actor:{id:'USR-M04-READ-CONSISTENT',role:'M04ReadConsistent'}
  },'valid source-consistent staff role retains existing view permission');
});

test('core second session SELECT rejects activity rewound after the heartbeat',async()=>{
  const start=BASE+1_500_000;
  const issued=await loginWithD1(DB,{
    phoneKey:'01710000001',password:PASSWORD,nowMs:start,
  });
  assert.equal(issued.authenticated,true);
  const digest=createHash('sha256').update(Buffer.from(issued.token,'hex')).digest('hex');
  const heartbeat=await validateSessionWithD1(DB,{
    token:issued.token,nowMs:start+1_000_000,
  });
  assert.equal(heartbeat.authenticated,true,'fresh session heartbeats normally succeed');
  const checkAt=start+2_000_000;
  let injected=0;
  // The core UPDATE succeeds and stamps checkAt. Simulate a concurrent
  // database write to this one synthetic session before the subsequent
  // actor SELECT; this adapter is local to the test and never deployed.
  const interleavedD1={
    prepare(sql){
      const stmt=DB.prepare(sql);
      if(!sql.includes('SELECT u.user_id,u.full_name,u.role_name FROM auth_sessions s'))
        return stmt;
      return {
        bind(...params){
          const query=stmt.bind(...params);
          return {
            async first(){
              injected++;
              await DB.prepare('UPDATE auth_sessions SET last_activity_at_ms=? WHERE token_hash=?')
                .bind(start,digest).run();
              return query.first();
            },
          };
        },
      };
    },
  };
  const raced=await validateSessionWithD1(interleavedD1,{
    token:issued.token,nowMs:checkAt,
  });
  assert.equal(injected,1,'rewind happened between the two real D1 statements');
  assert.deepEqual(raced,{authenticated:false},
    'the second actor lookup must not accept a session outside the idle window');
  const persisted=await DB.prepare('SELECT last_activity_at_ms FROM auth_sessions WHERE token_hash=?')
    .bind(digest).first();
  assert.equal(persisted.last_activity_at_ms,start);
  assert.deepEqual(await validateSessionWithD1(DB,{
    token:issued.token,nowMs:checkAt+1000,
  }),{authenticated:false},'ordinary future validation also refuses the stale session');
});


test('synthetic LegacyPending staff cannot validate a pre-upgrade session or advance its heartbeat',async()=>{
  const now=BASE+1_800_000;
  const userId='USR-M04-PENDING-SAFETY';
  const phone='01710000013';
  const credential=await createOfflinePasswordCredential(PASSWORD);
  await DB.prepare(`INSERT INTO auth_users
    (user_id,full_name,phone_key,role_name,status,credential_state,
     password_hash,password_salt,password_iterations)
    VALUES (?,?,?,'Administrator','Active','LegacyPending',?,?,?)`)
    .bind(userId,'Synthetic Pending Staff',phone,
      credential.passwordHash,credential.passwordSalt,credential.iterations).run();
  const versions=await DB.prepare(
    'SELECT auth_version,credential_version FROM auth_users WHERE user_id=?'
  ).bind(userId).first();
  const token='ab'.repeat(32);
  const digest=createHash('sha256').update(Buffer.from(token,'hex')).digest('hex');
  // A malformed historical import/privileged internal writer could create
  // this record. Its existence must never upgrade pending credentials into
  // a valid internet session.
  await DB.prepare(`INSERT INTO auth_sessions
    (token_hash,user_id,user_auth_version,role_auth_version,credential_version,
     created_at_ms,last_activity_at_ms,expires_at_ms)
    VALUES (?,?,?,NULL,?,?,?,?)`)
    .bind(digest,userId,versions.auth_version,versions.credential_version,
      now,now,now+60_000).run();

  assert.deepEqual(await validateSessionWithD1(DB,{token,nowMs:now+1000}),
    {authenticated:false});
  const persisted=await DB.prepare(
    'SELECT last_activity_at_ms FROM auth_sessions WHERE token_hash=?'
  ).bind(digest).first();
  assert.equal(persisted.last_activity_at_ms,now,
    'a pending-credential account must not receive a session heartbeat');
});


test('M04 real D1 staff session SQL-time Cash Session guard, replay, invalidation and rollback',async()=>{
  // Local-only synthetic cash operations use the real M04 auth schema.
  const ddl=[
    "CREATE TABLE m04_cash_probe_policy (id INTEGER PRIMARY KEY CHECK(id=1), session_required INTEGER NOT NULL DEFAULT 1 CHECK(session_required IN (0,1))) STRICT",
    "CREATE TABLE m04_cash_probe_sessions (session_id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('Open','Closed'))) STRICT",
    "CREATE TABLE m04_cash_probe_grants (role_name TEXT PRIMARY KEY, can_record INTEGER NOT NULL CHECK(can_record IN (0,1))) STRICT",
    "CREATE TABLE m04_cash_probe_intents (operation_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, cash_session_id TEXT, amount_minor INTEGER NOT NULL CHECK(amount_minor>0)) STRICT",
    "CREATE TABLE m04_cash_probe_journal (operation_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(amount_minor>0)) STRICT",
    "CREATE TRIGGER m04_cash_probe_append AFTER INSERT ON m04_cash_probe_intents BEGIN INSERT INTO m04_cash_probe_journal VALUES(NEW.operation_id,NEW.actor_id,NEW.amount_minor); SELECT CASE WHEN NEW.amount_minor=999 THEN RAISE(ABORT,'synthetic late abort') ELSE 1 END; END"
  ];
  for(const sql of ddl) await DB.prepare(sql).run();
  await DB.prepare("INSERT INTO m04_cash_probe_policy(id) VALUES (1)").run();
  await DB.prepare("INSERT INTO m04_cash_probe_sessions VALUES ('CS-CASH-PROOF','Open')").run();
  await DB.prepare("INSERT INTO auth_roles(role_name,status,permissions_json) VALUES ('M04CashProof','Active','{}')").run();
  await seed('USR-M04-CASH-PROOF','01710000016','M04CashProof');
  await DB.prepare("INSERT INTO m04_cash_probe_grants VALUES ('M04CashProof',1)").run();
  let serverTime=BASE+3_000_000;
  const gate=createM04RealAuthCashProbe(DB,{serverNowMs:()=>serverTime});
  const login=await rpc('login',{phoneKey:'01710000016',password:PASSWORD,nowMs:serverTime});
  assert.equal(login.body.authenticated,true);
  const token=login.body.token;
  const request=(more={})=>({
    token,operationId:'M04CASH-A',cashSessionId:'CS-CASH-PROOF',
    amountMinor:125,...more
  });
  const deny=async x=>assert.rejects(()=>gate.record_(x),/Denied|Invalid/i);
  const count=async table=>(await DB.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n;
  const intent='m04_cash_probe_intents',journal='m04_cash_probe_journal';

  assert.deepEqual(await gate.record_(request()),
    {operationId:'M04CASH-A',actorId:'USR-M04-CASH-PROOF',amountMinor:125});
  assert.deepEqual(await gate.record_(request()),
    {operationId:'M04CASH-A',actorId:'USR-M04-CASH-PROOF',amountMinor:125});
  assert.equal(await count(intent),1);
  assert.equal(await count(journal),1);
  await deny(request({amountMinor:126}));
  await deny(request({operationId:'M04CASH-MISSING',cashSessionId:null}));
  await deny(request({operationId:'M04CASH-CLAIM',actorId:'USR-ADMIN'}));
  await deny(request({operationId:'M04CASH-CLOCK',nowMs:serverTime-1000}));
  await deny(request({operationId:'M04CASH-SHOP',businessId:'OTHER'}));

  // Another logged-in actor cannot read or replay this immutable receipt.
  const other=await rpc('login',{
    phoneKey:'01710000001',password:PASSWORD,nowMs:serverTime
  });
  assert.equal(other.body.authenticated,true);
  await deny(request({token:other.body.token}));
  assert.equal(await count(intent),1);

  await DB.prepare("UPDATE m04_cash_probe_sessions SET status='Closed'").run();
  await deny(request({operationId:'M04CASH-CLOSED'}));
  await DB.prepare("UPDATE m04_cash_probe_sessions SET status='Open'").run();
  await deny(request({operationId:'M04CASH-ROLLBACK',amountMinor:999}));
  assert.equal(await count(intent),1,'late failure rolls back operation ID');
  assert.equal(await count(journal),1,'late failure rolls back journal entry');

  // Optional session feature OFF must never disable staff authorization.
  await DB.prepare("UPDATE m04_cash_probe_policy SET session_required=0 WHERE id=1").run();
  assert.deepEqual(await gate.record_(request({
    operationId:'M04CASH-OFF',cashSessionId:null,amountMinor:200
  })),{operationId:'M04CASH-OFF',actorId:'USR-M04-CASH-PROOF',amountMinor:200});
  await DB.prepare("UPDATE m04_cash_probe_grants SET can_record=0").run();
  await deny(request({operationId:'M04CASH-NOGRANT',cashSessionId:null}));
  await DB.prepare("UPDATE m04_cash_probe_grants SET can_record=1").run();

  // Role reactivation cannot reuse an old token after the SQL epoch changes.
  await DB.prepare("UPDATE auth_roles SET status='Inactive' WHERE role_name='M04CashProof'").run();
  await deny(request({operationId:'M04CASH-ROLE-DISABLED',cashSessionId:null}));
  await DB.prepare("UPDATE auth_roles SET status='Active' WHERE role_name='M04CashProof'").run();
  await deny(request({operationId:'M04CASH-ROLE-RESTORED',cashSessionId:null}));
  const fresh=await rpc('login',{
    phoneKey:'01710000016',password:PASSWORD,nowMs:serverTime+1000
  });
  assert.equal(fresh.body.authenticated,true);
  await DB.prepare("UPDATE auth_users SET credential_version=credential_version+1 WHERE user_id='USR-M04-CASH-PROOF'").run();
  await deny(request({token:fresh.body.token,operationId:'M04CASH-CREDENTIAL',cashSessionId:null}));

  // Revocation and both precise lifetime boundaries are SQL-enforced.
  const renewed=await rpc('login',{
    phoneKey:'01710000016',password:PASSWORD,nowMs:serverTime+2000
  });
  assert.equal(renewed.body.authenticated,true);
  const issuedAt=serverTime+2000;
  await rpc('logout',{token:renewed.body.token,nowMs:issuedAt+1000});
  serverTime=issuedAt+1000;
  await deny(request({token:renewed.body.token,operationId:'M04CASH-REVOKED',cashSessionId:null}));
  const idle=await rpc('login',{
    phoneKey:'01710000016',password:PASSWORD,nowMs:serverTime
  });
  assert.equal(idle.body.authenticated,true);
  serverTime+=30*60*1000;
  await deny(request({token:idle.body.token,operationId:'M04CASH-IDLE',cashSessionId:null}));
  const expiry=await rpc('login',{
    phoneKey:'01710000016',password:PASSWORD,nowMs:serverTime
  });
  assert.equal(expiry.body.authenticated,true);
  serverTime+=12*60*60*1000;
  await deny(request({token:expiry.body.token,operationId:'M04CASH-EXPIRED',cashSessionId:null}));
  assert.equal(await count(intent),2);
  assert.equal(await count(journal),2);
});


test('M04 source POS add/view grants are SQL-current against persisted roles and sessions',async()=>{
  // Disposable receipt/journal are not real Cash Session or Cash Book writers.
  const ddl=[
    "CREATE TABLE m04_source_pos_receipts (operation_id TEXT PRIMARY KEY, action TEXT NOT NULL CHECK(action IN ('startCashSession','closeCashSession')), actor_id TEXT NOT NULL) STRICT",
    "CREATE TABLE m04_source_pos_journal (operation_id TEXT PRIMARY KEY, action TEXT NOT NULL, actor_id TEXT NOT NULL) STRICT",
    "CREATE TRIGGER m04_source_pos_journal_trigger AFTER INSERT ON m04_source_pos_receipts BEGIN INSERT INTO m04_source_pos_journal VALUES(NEW.operation_id,NEW.action,NEW.actor_id); SELECT CASE WHEN NEW.operation_id='POS-FAIL' THEN RAISE(ABORT,'synthetic late failure') ELSE 1 END; END"
  ];
  for(const sql of ddl)await DB.prepare(sql).run();
  const addJSON=JSON.stringify({pos:{view:false,add:true,edit:false,delete:'disabled'}});
  const viewJSON=JSON.stringify({pos:{view:true,add:false,edit:false,delete:'disabled'}});
  const duplicate='{"pos":{"view":false,"add":true},"pos":{"view":false,"add":true}}';
  await DB.prepare("INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules) VALUES ('M04PosAdd','Active',?,''),('M04PosView','Active',?,'pos'),('M04PosDuplicate','Active',?,'')")
    .bind(addJSON,viewJSON,duplicate).run();
  await seed('USR-M04-POS-ADD','01710000017','M04PosAdd');
  await seed('USR-M04-POS-VIEW','01710000018','M04PosView');
  await seed('USR-M04-POS-DUP','01710000019','M04PosDuplicate');
  let now=BASE+4_000_000;
  const probe=createM04SourcePosActionProbe(DB,{serverNowMs:()=>now});
  const [addLogin,viewLogin,invalidLogin,adminLogin]=await Promise.all([
    rpc('login',{phoneKey:'01710000017',password:PASSWORD,nowMs:now}),
    rpc('login',{phoneKey:'01710000018',password:PASSWORD,nowMs:now}),
    rpc('login',{phoneKey:'01710000019',password:PASSWORD,nowMs:now}),
    rpc('login',{phoneKey:'01710000001',password:PASSWORD,nowMs:now})
  ]);
  for(const x of [addLogin,viewLogin,invalidLogin,adminLogin])
    assert.equal(x.body.authenticated,true);
  const add=addLogin.body.token,view=viewLogin.body.token;
  const deny=async cb=>assert.rejects(cb,/Denied|Invalid/i);
  const call=(token,operationId,action='startCashSession')=>({token,operationId,action});
  const count=async table=>(await DB.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n;

  assert.deepEqual(await probe.mutate_(call(add,'POS-START-1')),
    {operationId:'POS-START-1',action:'startCashSession',actorId:'USR-M04-POS-ADD'});
  assert.deepEqual(await probe.mutate_(call(add,'POS-START-1')),
    {operationId:'POS-START-1',action:'startCashSession',actorId:'USR-M04-POS-ADD'});
  assert.deepEqual(await probe.mutate_(call(add,'POS-CLOSE-1','closeCashSession')),
    {operationId:'POS-CLOSE-1',action:'closeCashSession',actorId:'USR-M04-POS-ADD'});
  assert.equal(await count('m04_source_pos_receipts'),2);
  assert.equal(await count('m04_source_pos_journal'),2);
  await deny(()=>probe.summary_({token:add}),'pos.add must not imply pos.view');
  await deny(()=>probe.mutate_(call(view,'POS-VIEW-CANNOT-ADD')));
  assert.deepEqual(await probe.summary_({token:view}),
    {action:'getCashSessionSummary',actorId:'USR-M04-POS-VIEW'});
  assert.equal(await count('m04_source_pos_receipts'),2,'summary must never write a synthetic receipt');
  await deny(()=>probe.mutate_(call(view,'POS-START-1')),'other actor cannot replay receipt');
  await deny(()=>probe.mutate_(call(add,'POS-START-1','closeCashSession')));
  await deny(()=>probe.mutate_(call(invalidLogin.body.token,'POS-DUPLICATE-JSON')));
  await deny(()=>probe.mutate_(call(add,'POS-FAIL')));
  assert.equal(await count('m04_source_pos_receipts'),2,'late insert abort must roll back receipt');
  assert.equal(await count('m04_source_pos_journal'),2,'late insert abort must roll back journal');
  await deny(()=>probe.mutate_({...call(add,'POS-FORGED'),actorId:'USR-ADMIN'}));
  await deny(()=>probe.mutate_({...call(add,'POS-FORGED'),module:'pos'}));
  await deny(()=>probe.mutate_({...call(add,'POS-FORGED'),nowMs:now+1000}));
  await deny(()=>probe.mutate_(call(add,'POS-BAD-METHOD','getCashSessionSummary')));

  assert.deepEqual(await probe.summary_({token:adminLogin.body.token}),
    {action:'getCashSessionSummary',actorId:'USR-ADMIN'},
    'Administrator still requires a live authenticated D1 session');
  assert.deepEqual(await probe.mutate_(call(adminLogin.body.token,'POS-ADMIN-CLOSE','closeCashSession')),
    {operationId:'POS-ADMIN-CLOSE',action:'closeCashSession',actorId:'USR-ADMIN'});

  // Role metadata contradiction and SQL epoch must both block a current write.
  await DB.prepare("UPDATE auth_roles SET allowed_modules='pos' WHERE role_name='M04PosAdd'").run();
  await deny(()=>probe.mutate_(call(add,'POS-DRIFT')));
  await DB.prepare("UPDATE auth_roles SET allowed_modules='' WHERE role_name='M04PosAdd'").run();
  await deny(()=>probe.mutate_(call(add,'POS-EPOCH-OLD')));
  const newLogin=await rpc('login',{
    phoneKey:'01710000017',password:PASSWORD,nowMs:now+1000
  });
  assert.equal(newLogin.body.authenticated,true);
  await DB.prepare("UPDATE auth_roles SET status='Inactive' WHERE role_name='M04PosAdd'").run();
  await deny(()=>probe.mutate_(call(newLogin.body.token,'POS-ROLE-OFF')));
  await DB.prepare("UPDATE auth_roles SET status='Active' WHERE role_name='M04PosAdd'").run();
  await deny(()=>probe.mutate_(call(newLogin.body.token,'POS-ROLE-RESTORED')));
  const renewed=await rpc('login',{
    phoneKey:'01710000017',password:PASSWORD,nowMs:now+2000
  });
  assert.equal(renewed.body.authenticated,true);
  await DB.prepare("UPDATE auth_users SET credential_version=credential_version+1 WHERE user_id='USR-M04-POS-ADD'").run();
  await deny(()=>probe.mutate_(call(renewed.body.token,'POS-CREDENTIAL-OLD')));
  await rpc('logout',{token:adminLogin.body.token,nowMs:now+1000});
  await deny(()=>probe.summary_({token:adminLogin.body.token}));
  await deny(()=>probe.mutate_(call(adminLogin.body.token,'POS-ADMIN-REVOKED')));
  assert.equal(await count('m04_source_pos_receipts'),3);
  assert.equal(await count('m04_source_pos_journal'),3);
});
