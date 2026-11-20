import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {createOfflinePasswordCredential} from '../../src/auth/d1-auth-core.js';

const harness=createTestHarness({workers:[{
  configPath:'./wrangler.m03-local-cash-session-test.jsonc'
}]});
const worker=harness.getWorker('shererp-m03-cash-session-local-only');
const NOW=1_800_200_000_000;
const PASS='SyntheticM03Cash!2026';
let DB;

async function rpc(path,body={}){
  const response=await worker.fetch('http://local-cash.invalid/__m03_cash_test__/'+path,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
  });
  return {status:response.status,body:await response.json()};
}
async function seed(id,phone,role){
  const credential=await createOfflinePasswordCredential(PASS);
  await DB.prepare(`INSERT INTO auth_users
    (user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations)
    VALUES (?,?,?,?,'Active',?,?,?)`).bind(id,'Synthetic '+id,phone,role,
      credential.passwordHash,credential.passwordSalt,credential.iterations).run();
}
const count=async table=>(await DB.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n;

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  const ddl=[
    `CREATE TABLE m03_local_cash_sessions(
      session_id TEXT PRIMARY KEY,open_op TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK(status IN('Starting','Open','Closing','Closed')),
      opening_minor INTEGER NOT NULL CHECK(opening_minor>=0),
      opened_ms INTEGER NOT NULL,open_actor TEXT NOT NULL,
      close_op TEXT UNIQUE,counted_minor INTEGER,closed_ms INTEGER,close_actor TEXT,
      CHECK((status IN('Starting','Open') AND close_op IS NULL AND counted_minor IS NULL)
        OR (status IN('Closing','Closed') AND close_op IS NOT NULL AND
            counted_minor IS NOT NULL AND close_actor IS NOT NULL))
    ) STRICT`,
    "CREATE UNIQUE INDEX one_active_local_cash_session ON m03_local_cash_sessions ((1)) WHERE status IN ('Starting','Open','Closing')",
    "CREATE TABLE m03_local_cash_marks(session_id TEXT NOT NULL,kind TEXT NOT NULL,minor INTEGER NOT NULL CHECK(minor=0),PRIMARY KEY(session_id,kind)) STRICT",
    `CREATE TRIGGER m03_local_cash_open_marker AFTER INSERT ON m03_local_cash_sessions
      BEGIN INSERT INTO m03_local_cash_marks VALUES(NEW.session_id,'Session Open',0); END`,
    `CREATE TRIGGER m03_local_cash_close_marker AFTER UPDATE OF status ON m03_local_cash_sessions
      WHEN NEW.status='Closed' AND OLD.status='Closing'
      BEGIN INSERT INTO m03_local_cash_marks VALUES(NEW.session_id,'Session Close',0); END`,
    "CREATE TABLE m03_local_cash_policy(id INTEGER PRIMARY KEY CHECK(id=1),session_required INTEGER NOT NULL CHECK(session_required IN (0,1))) STRICT",
    "INSERT INTO m03_local_cash_policy(id,session_required) VALUES (1,1)",
    `CREATE TABLE m03_local_cash_intents(
      operation_id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,
      session_id TEXT,amount_minor INTEGER NOT NULL CHECK(amount_minor>0)
    ) STRICT`,
    "CREATE TABLE m03_local_cash_journal(operation_id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,amount_minor INTEGER NOT NULL CHECK(amount_minor>0)) STRICT",
    `CREATE TRIGGER m03_local_cash_journal_append AFTER INSERT ON m03_local_cash_intents
      BEGIN INSERT INTO m03_local_cash_journal VALUES(NEW.operation_id,NEW.actor_id,NEW.amount_minor);
      SELECT CASE WHEN NEW.amount_minor=999 THEN RAISE(ABORT,'synthetic late failure') ELSE 1 END; END`,
    "CREATE TABLE m03_local_historical_opening(reference TEXT PRIMARY KEY,amount_minor INTEGER NOT NULL) STRICT",
    "INSERT INTO m03_local_historical_opening VALUES ('HIST-1',4200)"
  ];
  for(const sql of ddl)await DB.prepare(sql).run();
  const add=JSON.stringify({pos:{view:false,add:true,edit:false,delete:'disabled'}});
  const view=JSON.stringify({pos:{view:true,add:false,edit:false,delete:'disabled'}});
  await DB.prepare(`INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules)
    VALUES ('LocalPosAdd','Active',?,''),('LocalPosView','Active',?,'pos')`)
    .bind(add,view).run();
  await seed('LOCAL-ADD','01710000021','LocalPosAdd');
  await seed('LOCAL-VIEW','01710000022','LocalPosView');
  await seed('LOCAL-ADMIN','01710000023','Administrator');
});
after(async()=>harness.close());

test('real local Workerd/D1 current auth controls interrupted Start, Open-only cash intent, Closing resume and historical isolation',async()=>{
  const addLogin=await rpc('login',{phoneKey:'01710000021',password:PASS});
  const viewLogin=await rpc('login',{phoneKey:'01710000022',password:PASS});
  const adminLogin=await rpc('login',{phoneKey:'01710000023',password:PASS});
  for(const r of [addLogin,viewLogin,adminLogin])assert.equal(r.body.authenticated,true);
  const add=addLogin.body.token,view=viewLogin.body.token,admin=adminLogin.body.token;
  const start=(token=add,extra={})=>({token,operationId:'OPEN-1',openingMinor:2500,...extra});
  const close=(token=add,extra={})=>({token,sessionId:'CS-OPEN-1',operationId:'CLOSE-1',countedMinor:2475,...extra});
  const intent=(token=add,extra={})=>({token,operationId:'CASH-1',sessionId:'CS-OPEN-1',amountMinor:125,...extra});
  const denied=async(path,body)=>{
    const r=await rpc(path,body);
    assert.equal(r.status,403,JSON.stringify({path,body:r.body}));
    assert.deepEqual(r.body,{error:'Denied'});
  };

  await denied('start',start(view));
  // Late failure of the zero-value Open marker MUST abort the entire
  // attempted session INSERT; no orphan Starting row or marker survives.
  await DB.prepare(`CREATE TRIGGER m03_local_cash_open_abort
    AFTER INSERT ON m03_local_cash_sessions WHEN NEW.open_op='OPEN-FAIL'
    BEGIN SELECT RAISE(ABORT,'injected marker failure'); END`).run();
  await denied('start',start(add,{operationId:'OPEN-FAIL'}));
  assert.equal(await count('m03_local_cash_sessions'),0);
  assert.equal(await count('m03_local_cash_marks'),0);
  await DB.prepare('DROP TRIGGER m03_local_cash_open_abort').run();

  const interrupted=await rpc('start',start(add,{testInterruptAfterClaim:true}));
  assert.equal(interrupted.status,202);
  assert.deepEqual(interrupted.body,{sessionId:'CS-OPEN-1',status:'Starting',needsResume:true});
  assert.equal((await DB.prepare("SELECT status FROM m03_local_cash_sessions WHERE session_id='CS-OPEN-1'").first()).status,'Starting');
  await denied('cash-intent',intent());
  assert.equal(await count('m03_local_cash_marks'),1);
  assert.equal((await DB.prepare('SELECT minor FROM m03_local_cash_marks').first()).minor,0);

  assert.deepEqual((await rpc('start',start())).body,
    {sessionId:'CS-OPEN-1',status:'Open',openingMinor:2500,actorId:'LOCAL-ADD'});
  assert.equal((await rpc('start',start())).status,200);
  await denied('start',start(add,{openingMinor:2600}));
  await denied('start',start(add,{operationId:'OPEN-2'}));
  await denied('start',{...start(),actorId:'LOCAL-ADMIN'});
  await denied('start',{...start(),nowMs:NOW+1000});
  await denied('summary',{token:add});
  const summary=await rpc('summary',{token:view});
  assert.equal(summary.status,200);
  assert.deepEqual(summary.body,{sessionId:'CS-OPEN-1',status:'Open',openingMinor:2500});
  assert.equal(await count('m03_local_cash_marks'),1);

  assert.deepEqual((await rpc('cash-intent',intent())).body,
    {operationId:'CASH-1',actorId:'LOCAL-ADD',amountMinor:125});
  assert.equal((await rpc('cash-intent',intent())).status,200);
  await denied('cash-intent',intent(admin));
  await denied('cash-intent',intent(add,{amountMinor:130}));
  await denied('cash-intent',intent(add,{operationId:'CASH-FAIL',amountMinor:999}));
  assert.equal(await count('m03_local_cash_intents'),1);
  assert.equal(await count('m03_local_cash_journal'),1);
  await denied('cash-intent',intent(view,{operationId:'CASH-VIEW'}));

  await denied('close',close(view));
  const partialClose=await rpc('close',close(add,{testInterruptAfterClaim:true}));
  assert.deepEqual(partialClose,{status:202,body:{sessionId:'CS-OPEN-1',status:'Closing',needsResume:true}});
  await denied('cash-intent',intent(add,{operationId:'CASH-CLOSING'}));
  await denied('start',start(add,{operationId:'OPEN-2'}));
  assert.deepEqual((await rpc('summary',{token:view})).body,
    {sessionId:'CS-OPEN-1',status:'Closing',openingMinor:2500});

  // Closing is durable across statements. A failed final Close marker
  // rolls back just the final transition, leaving the same close receipt
  // for explicit retry; it never fabricates a book movement.
  await DB.prepare(`CREATE TRIGGER m03_local_cash_close_abort
    BEFORE UPDATE OF status ON m03_local_cash_sessions
    WHEN NEW.status='Closed' AND NEW.close_op='CLOSE-1'
    BEGIN SELECT RAISE(ABORT,'injected close marker failure'); END`).run();
  await denied('close',close());
  assert.equal((await DB.prepare(
    "SELECT status FROM m03_local_cash_sessions WHERE session_id='CS-OPEN-1'"
  ).first()).status,'Closing');
  assert.equal(await count('m03_local_cash_marks'),1);
  await DB.prepare('DROP TRIGGER m03_local_cash_close_abort').run();

  const closed=await rpc('close',close());
  assert.equal(closed.status,200);
  assert.deepEqual(closed.body,{sessionId:'CS-OPEN-1',status:'Closed',
    countedMinor:2475,actorId:'LOCAL-ADD'});
  assert.equal((await rpc('close',close())).status,200);
  await denied('close',close(add,{countedMinor:2476}));
  await denied('cash-intent',intent(add,{operationId:'CASH-CLOSED'}));
  assert.equal(await count('m03_local_cash_marks'),2);
  assert.equal(await count('m03_local_cash_intents'),1);
  assert.deepEqual(await DB.prepare('SELECT reference,amount_minor FROM m03_local_historical_opening').first(),
    {reference:'HIST-1',amount_minor:4200});

  await DB.prepare('UPDATE m03_local_cash_policy SET session_required=0 WHERE id=1').run();
  assert.deepEqual((await rpc('cash-intent',intent(add,{
    operationId:'CASH-OFF',sessionId:null,amountMinor:110
  }))).body,{operationId:'CASH-OFF',actorId:'LOCAL-ADD',amountMinor:110});
  await denied('cash-intent',intent(view,{operationId:'CASH-OFF-VIEW',sessionId:null}));
  await DB.prepare('UPDATE m03_local_cash_policy SET session_required=1 WHERE id=1').run();
  await denied('cash-intent',intent(add,{operationId:'CASH-NO-OPEN',sessionId:null}));
  const second=await rpc('start',start(admin,{operationId:'OPEN-2',openingMinor:2400}));
  assert.deepEqual(second.body,{sessionId:'CS-OPEN-2',status:'Open',
    openingMinor:2400,actorId:'LOCAL-ADMIN'});
  assert.equal(await count('m03_local_cash_marks'),3);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM m03_local_cash_marks WHERE minor<>0').first()).n,0);
});

test('role revocation, role restoration and logout block new SQL-authorized Cash Session actions',async()=>{
  const addLogin=await rpc('login',{phoneKey:'01710000021',password:PASS});
  assert.equal(addLogin.body.authenticated,true);
  const token=addLogin.body.token;
  await DB.prepare("UPDATE auth_roles SET status='Inactive' WHERE role_name='LocalPosAdd'").run();
  assert.equal((await rpc('cash-intent',{
    token,operationId:'CASH-REVOKED',sessionId:'CS-OPEN-2',amountMinor:20
  })).status,403);
  await DB.prepare("UPDATE auth_roles SET status='Active' WHERE role_name='LocalPosAdd'").run();
  assert.equal((await rpc('cash-intent',{
    token,operationId:'CASH-RESTORED',sessionId:'CS-OPEN-2',amountMinor:20
  })).status,403);
  const renewed=await rpc('login',{phoneKey:'01710000021',password:PASS});
  assert.equal(renewed.body.authenticated,true);
  assert.equal((await rpc('cash-intent',{
    token:renewed.body.token,operationId:'CASH-NEW',sessionId:'CS-OPEN-2',amountMinor:20
  })).status,200);
  const digest=await DB.prepare("SELECT token_hash FROM auth_sessions WHERE user_id='LOCAL-ADD' ORDER BY created_at_ms DESC LIMIT 1").first();
  assert.ok(digest.token_hash);
  await DB.prepare("UPDATE auth_users SET credential_version=credential_version+1 WHERE user_id='LOCAL-ADD'").run();
  assert.equal((await rpc('cash-intent',{
    token:renewed.body.token,operationId:'CASH-CREDENTIAL',sessionId:'CS-OPEN-2',amountMinor:20
  })).status,403);
});
