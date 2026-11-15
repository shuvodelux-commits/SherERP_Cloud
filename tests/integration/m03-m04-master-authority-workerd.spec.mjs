import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createTestHarness} from 'wrangler';
import {SYNTHETIC_M03_MASTER_ATOMIC_DDL} from '../fixtures/m03-master-atomic-schema.mjs';
import {SYNTHETIC_M03_M04_MASTER_AUTH_DDL} from '../fixtures/m03-m04-master-authority-schema.mjs';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m03-m04-master-authority-test.jsonc'}]});
const worker=harness.getWorker('shererp-m03-m04-master-authority-local');
const NOW=1_800_000_000_000;
const hash=t=>createHash('sha256').update(Buffer.from(t,'hex')).digest('hex');
let DB;
async function state(){
  const output={};
  for(const [key,sql] of Object.entries({
    categories:'SELECT category_id,category_name,legacy_sheet_row FROM product_categories ORDER BY legacy_sheet_row',
    units:'SELECT unit_id,unit_name,legacy_sheet_row FROM product_units ORDER BY legacy_sheet_row',
    counters:'SELECT id_key,current_sequence FROM synthetic_m03_id_counters ORDER BY id_key',
    receipts:'SELECT id_key,operation_id,issued_sequence FROM synthetic_m03_id_receipts ORDER BY id_key,operation_id',
    intents:'SELECT id_key,operation_id,result_id,actor_id FROM synthetic_m03_master_intents ORDER BY id_key,operation_id'
  }))output[key]=(await DB.prepare(sql).all()).results.map(x=>({...x}));
  return output;
}
async function invoke(path,body){
  const response=await worker.fetch('http://isolated.local'+path,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body??{ignored:true})
  });
  return {status:response.status,body:await response.json()};
}
before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  const src=readFileSync(new URL('../../migrations/0001_core_catalog.sql',import.meta.url),'utf8')
    .replace(/^--.*$/gm,'');
  const start=src.indexOf('CREATE TABLE product_categories (');
  assert.ok(start>=0,'M02 Product master source DDL');
  for(const segment of src.slice(start).split(';')){
    if(segment.trim())await DB.prepare(segment.trim()).run();
  }
  for(const sql of SYNTHETIC_M03_MASTER_ATOMIC_DDL)await DB.prepare(sql).run();
  for(const sql of SYNTHETIC_M03_M04_MASTER_AUTH_DDL)await DB.prepare(sql).run();

  await DB.prepare("INSERT INTO product_categories(category_id,category_name,status,legacy_sheet_row) VALUES('PCAT-000016','Electrical','Active',2)").run();
  await DB.prepare("INSERT INTO product_units(unit_id,unit_name,status,legacy_sheet_row) VALUES('PUNT-000007','Pcs','Active',2)").run();
  await DB.prepare("INSERT INTO synthetic_m03_id_counters(tenant_id,id_key,prefix,current_sequence) VALUES('BUS-A','PRODUCT_CATEGORIES','PCAT',16),('BUS-A','PRODUCT_UNITS','PUNT',7)").run();
  await DB.prepare("INSERT INTO auth_roles(role_name,status,permissions_json) VALUES('ProductClerk','Active','{\"products\":{\"add\":true}}'),('NoAdd','Active','{\"products\":{\"add\":\"true\"}}')").run();
  for(const [id,phone,role] of [
    ['ADMIN','01710000001','Administrator'],
    ['STAFF','01710000002','ProductClerk'],
    ['NOADD','01710000003','NoAdd']
  ])await DB.prepare("INSERT INTO auth_users(user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations) VALUES(?,?,?,?,'Active',?,?,210000)")
    .bind(id,'Fixture '+id,phone,role,'d'.repeat(64),'e'.repeat(48)).run();
  for(const [token,id,roleEpoch,last,expiry,revoked] of [
    ['a','ADMIN',null,NOW-60_000,NOW+600_000,null],
    ['b','STAFF',1,NOW-60_000,NOW+600_000,null],
    ['c','NOADD',1,NOW-60_000,NOW+600_000,null],
    ['d','STAFF',1,NOW-60_000,NOW+600_000,NOW-1],
    ['e','STAFF',1,NOW-60_000,NOW-1,null],
    ['f','STAFF',1,NOW-1_800_000,NOW+600_000,null]
  ])await DB.prepare("INSERT INTO auth_sessions(token_hash,user_id,user_auth_version,role_auth_version,credential_version,created_at_ms,last_activity_at_ms,expires_at_ms,revoked_at_ms) VALUES (?,?,1,?,1,?,?,?,?)")
    .bind(hash(token.repeat(64)),id,roleEpoch,NOW-2_000_000,last,expiry,revoked).run();
});
after(async()=>{await harness.close();});

test('same SQLite mutation authorizes Administrator and actor-stamps immutable PCAT receipt',async()=>{
  assert.deepEqual(await invoke('/__m03_m04_master__/admin-category'),{
    status:200,body:{success:true,data:{id:'PCAT-000017',name:'Tools'}}
  });
  const s=await state();
  assert.equal(s.intents.length,1);
  assert.equal(s.intents[0].actor_id,'ADMIN');
  assert.equal(s.categories.at(-1).category_id,'PCAT-000017');
  const before=await state();
  assert.deepEqual(await invoke('/__m03_m04_master__/admin-replay'),{
    status:200,body:{success:true,data:{id:'PCAT-000017',name:'Tools'}}
  });
  assert.deepEqual(await state(),before);
});

test('actor-bound replay refuses second actor and changed intent without exposing original source ID',async()=>{
  const before=await state();
  assert.equal((await invoke('/__m03_m04_master__/cross-actor')).status,403);
  assert.equal((await invoke('/__m03_m04_master__/admin-collision')).status,403);
  assert.deepEqual(await state(),before);
});

test('literal-true current M04 products.add role can create PUNT; false/string/revoked/expired/idle deny without mutations',async()=>{
  assert.deepEqual(await invoke('/__m03_m04_master__/staff-unit'),{
    status:200,body:{success:true,data:{id:'PUNT-000008',name:'গিরা'}}
  });
  assert.equal((await state()).intents.at(-1).actor_id,'STAFF');
  const before=await state();
  for(const route of ['no-add','revoked','expired','idle','unknown']){
    assert.equal((await invoke('/__m03_m04_master__/'+route)).status,403,route);
    assert.deepEqual(await state(),before,route);
  }
  await DB.prepare("UPDATE auth_roles SET permissions_json='{\"products\":{\"add\":false}}' WHERE role_name='ProductClerk'").run();
  assert.equal((await invoke('/__m03_m04_master__/staff-after-change')).status,403);
  await DB.prepare("UPDATE auth_roles SET permissions_json='{\"products\":{\"add\":true}}' WHERE role_name='ProductClerk'").run();
  assert.equal((await invoke('/__m03_m04_master__/staff-after-change')).status,403,
    'old session epoch cannot regain permission on regrant');
  assert.deepEqual(await state(),before);
});

test('late catalog write error rolls back intent, actor stamp, source ID counter and receipt',async()=>{
  await DB.prepare("CREATE TRIGGER master_fault BEFORE INSERT ON product_categories WHEN NEW.category_name='Fault' BEGIN SELECT RAISE(ABORT,'synthetic late failure'); END").run();
  const before=await state();
  assert.equal((await invoke('/__m03_m04_master__/fault')).status,403);
  assert.deepEqual(await state(),before);
  await DB.prepare('DROP TRIGGER master_fault').run();
});

test('lost result retry returns one actor-bound ID and invalid external payload does not alter server action',async()=>{
  assert.equal((await invoke('/__m03_m04_master__/lost')).status,503);
  const before=await state();
  assert.deepEqual(await invoke('/__m03_m04_master__/lost-replay',{
    actorId:'STAFF',token:'f'.repeat(64),name:'FORGED',sql:'DELETE FROM auth_users'
  }),{status:200,body:{success:true,data:{id:'PCAT-000018',name:'Tape'}}});
  assert.deepEqual(await state(),before);
  assert.equal((await invoke('/__m03_m04_master__/unknown-route')).status,404);
  const live=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  assert.doesNotMatch(live,/m03-m04-master-authorized-create/);
  assert.equal(JSON.parse(readFileSync(new URL('../../wrangler.m03-m04-master-authority-test.jsonc',import.meta.url),'utf8')).workers_dev,false);
});


async function issueCurrentStaffSession(letter){
  const user=await DB.prepare("SELECT auth_version,credential_version FROM auth_users WHERE user_id='STAFF'").first();
  const role=await DB.prepare("SELECT auth_version FROM auth_roles WHERE role_name='ProductClerk'").first();
  await DB.prepare("INSERT INTO auth_sessions(token_hash,user_id,user_auth_version,role_auth_version,credential_version,created_at_ms,last_activity_at_ms,expires_at_ms,revoked_at_ms) VALUES(?,?,?,?,?,?,?,?,NULL)")
    .bind(hash(letter.repeat(64)),'STAFF',user.auth_version,role.auth_version,
      user.credential_version,NOW-300_000,NOW-1_000,NOW+600_000).run();
}

test('current M04 role/user disable, malformed grant and restoration deny stale staff epochs',async()=>{
  await issueCurrentStaffSession('2');
  assert.deepEqual(await invoke('/__m03_m04_master__/staff-fresh'),{
    status:200,body:{success:true,data:{id:'PUNT-000009',name:'Box'}}
  });
  const frozen=await state();
  await DB.prepare("UPDATE auth_roles SET status='Inactive' WHERE role_name='ProductClerk'").run();
  assert.equal((await invoke('/__m03_m04_master__/staff-fresh')).status,403);
  await DB.prepare("UPDATE auth_roles SET status='Active' WHERE role_name='ProductClerk'").run();
  assert.equal((await invoke('/__m03_m04_master__/staff-fresh')).status,403,
    'role reactivation cannot resurrect the old role epoch');

  await DB.prepare("UPDATE auth_roles SET permissions_json='{' WHERE role_name='ProductClerk'").run();
  await issueCurrentStaffSession('4');
  assert.equal((await invoke('/__m03_m04_master__/staff-malformed')).status,403,
    'malformed JSON permission must fail closed without SQL mutation');
  await DB.prepare("UPDATE auth_roles SET permissions_json='{\"products\":{\"add\":true}}' WHERE role_name='ProductClerk'").run();

  await DB.prepare("UPDATE auth_users SET status='Inactive' WHERE user_id='STAFF'").run();
  assert.equal((await invoke('/__m03_m04_master__/staff-fresh')).status,403);
  await DB.prepare("UPDATE auth_users SET status='Active' WHERE user_id='STAFF'").run();
  assert.equal((await invoke('/__m03_m04_master__/staff-fresh')).status,403,
    'account reactivation cannot restore the old bearer');
  assert.deepEqual(await state(),frozen);
});

test('revocation racing actual source master INSERT permits only fully serialized outcome',async()=>{
  await issueCurrentStaffSession('3');
  const before=await state();
  const [call,revoke]=await Promise.allSettled([
    invoke('/__m03_m04_master__/staff-race'),
    DB.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?')
      .bind(NOW,hash('3'.repeat(64))).run()
  ]);
  assert.equal(call.status,'fulfilled');
  assert.equal(revoke.status,'fulfilled');
  assert.ok([200,403].includes(call.value.status));
  const afterState=await state();
  const newIntents=afterState.intents.filter(x=>x.operation_id==='OP-STAFF-RACE');
  const newReceipts=afterState.receipts.filter(x=>x.operation_id==='OP-STAFF-RACE');
  const newUnits=afterState.units.filter(x=>x.unit_name==='Meter');
  const delta=newIntents.length;
  assert.ok(delta===0||delta===1);
  assert.equal(newReceipts.length,delta);
  assert.equal(newUnits.length,delta);
  assert.equal(afterState.counters.find(x=>x.id_key==='PRODUCT_UNITS').current_sequence,
    before.counters.find(x=>x.id_key==='PRODUCT_UNITS').current_sequence+delta);
  if(call.value.status===200){
    assert.equal(delta,1);
    assert.equal(newIntents[0].actor_id,'STAFF');
  }
  assert.equal((await invoke('/__m03_m04_master__/staff-race')).status,403,
    'replayed receipt requires current nonrevoked bearer even after committed write');
  assert.deepEqual(await state(),afterState);
});

test('credential rotation denies old Administrator receipt replay and SQL actor mutation',async()=>{
  const before=await state();
  await assert.rejects(()=>DB.prepare(
    "UPDATE synthetic_m03_master_intents SET actor_id='STAFF' WHERE operation_id='OP-ADMIN'"
  ).run(),/immutable|D1_ERROR|constraint|abort/i);
  assert.deepEqual(await state(),before);

  await DB.prepare("UPDATE auth_users SET password_hash=? WHERE user_id='ADMIN'")
    .bind('c'.repeat(64)).run();
  assert.equal((await invoke('/__m03_m04_master__/admin-replay')).status,403);
  assert.equal((await invoke('/__m03_m04_master__/admin-after-password')).status,403);
  assert.deepEqual(await state(),before);
});
