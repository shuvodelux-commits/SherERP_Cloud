import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createTestHarness} from 'wrangler';
import {SYNTHETIC_M03_M04_AUTHORIZED_MASTER_DDL}
  from '../fixtures/m03-m04-authorized-master-schema.mjs';

const harness=createTestHarness({workers:[
  {configPath:'./wrangler.m03-m04-authorized-master-test.jsonc'}
]});
const worker=harness.getWorker('shererp-m03-m04-authorized-master-local-test');
const NOW=1_800_000_000_000;
const token={ADMIN:'a'.repeat(64),STAFF:'b'.repeat(64),
  DENY:'c'.repeat(64),ALT:'d'.repeat(64),STRING:'e'.repeat(64)};
const hash=value=>createHash('sha256').update(Buffer.from(value,'hex')).digest('hex');
let DB;
const query=async sql=>{
  const out=await DB.prepare(sql).all();
  assert.equal(out.success,true);
  return out.results.map(r=>({...r}));
};
async function state(){
  return {
    categories:await query('SELECT category_id,category_name,status,legacy_sheet_row FROM product_categories ORDER BY legacy_sheet_row'),
    units:await query('SELECT unit_id,unit_name,status,legacy_sheet_row FROM product_units ORDER BY legacy_sheet_row'),
    counters:await query('SELECT id_key,current_sequence FROM synthetic_m03_id_counters ORDER BY id_key'),
    intents:await query('SELECT id_key,operation_id,actor_id,result_id FROM synthetic_m03_master_intents ORDER BY id_key,operation_id'),
    receipts:await query('SELECT id_key,operation_id,issued_sequence FROM synthetic_m03_id_receipts ORDER BY id_key,operation_id')
  };
}
async function call(route,body,method='POST'){
  const response=await worker.fetch('http://m03-m04-master.local'+route,{
    method,...((body!==undefined&&method!=='GET'&&method!=='HEAD')?
      {headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})
  });
  return {status:response.status,body:await response.json()};
}

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  const core=readFileSync(new URL('../../migrations/0001_core_catalog.sql',import.meta.url),'utf8');
  const catalog=core.match(/CREATE TABLE product_(?:categories|units) \([\s\S]*?\) STRICT;/g);
  assert.equal(catalog?.length,2,'must reuse exactly the two reviewed catalog schemas');
  for(const ddl of catalog)assert.equal((await DB.prepare(ddl).run()).success,true);
  for(const ddl of SYNTHETIC_M03_M04_AUTHORIZED_MASTER_DDL)
    assert.equal((await DB.prepare(ddl).run()).success,true);
  assert.equal((await DB.prepare("INSERT INTO product_categories(category_id,category_name,status,legacy_sheet_row) VALUES "+
    "('PCAT-000002','Electrical','Active',2),('PCAT-000005','Wire','Inactive',3),"+
    "('PCAT-000006',' wire ','Paused',4),('PCAT-000016','Other','Active',5)").run()).success,true);
  assert.equal((await DB.prepare("INSERT INTO product_units(unit_id,unit_name,status,legacy_sheet_row) VALUES "+
    "('PUNT-000007','Pcs','Active',2)").run()).success,true);
  assert.equal((await DB.prepare("INSERT INTO synthetic_m03_id_counters(tenant_id,id_key,prefix,current_sequence) VALUES "+
    "('BUS-A','PRODUCT_CATEGORIES','PCAT',16),('BUS-A','PRODUCT_UNITS','PUNT',7)").run()).success,true);
  for(const [role,permissions] of [
    ['Cashier','{"products":{"add":true}}'],
    ['Viewer','{"products":{"add":false}}'],
    ['StringGrant','{"products":{"add":"true"}}']
  ]){
    assert.equal((await DB.prepare(
      "INSERT INTO auth_roles(role_name,status,permissions_json) VALUES(?,'Active',?)"
    ).bind(role,permissions).run()).success,true);
  }
  for(const [id,role,phone] of [
    ['ADMIN','Administrator','01710000001'],['STAFF','Cashier','01710000002'],
    ['DENY','Viewer','01710000003'],['ALT','Administrator','01710000004'],
    ['STRING','StringGrant','01710000005']
  ]){
    assert.equal((await DB.prepare('INSERT INTO auth_users '+
      '(user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations) '+
      "VALUES(?,?,?,?,'Active',?,?,210000)")
      .bind(id,'Test '+id,phone,'ab'.repeat(32),'cd'.repeat(24)).run()).success,true);
  }
  for(const [id,key,epoch] of [
    ['ADMIN',token.ADMIN,null],['STAFF',token.STAFF,1],
    ['DENY',token.DENY,1],['ALT',token.ALT,null],['STRING',token.STRING,1]
  ]){
    assert.equal((await DB.prepare('INSERT INTO auth_sessions '+
      '(token_hash,user_id,user_auth_version,role_auth_version,credential_version,'+
      'created_at_ms,last_activity_at_ms,expires_at_ms) VALUES(?,?,1,?,1,?,?,?)')
      .bind(hash(key),id,epoch,NOW-90_000,NOW-30_000,NOW+1_000_000).run()).success,true);
  }
});
after(async()=>{await harness.close();});

test('Administrator creates real D1 PCAT and same authorized actor replays exact receipt',async()=>{
  assert.deepEqual(await call('/__m04_master__/admin-tools'),{
    status:200,body:{success:true,data:{id:'PCAT-000017',name:'Tools'}}
  });
  const before=await state();
  assert.deepEqual(before.intents.map(v=>[v.actor_id,v.result_id]),[['ADMIN','PCAT-000017']]);
  assert.deepEqual(await call('/__m04_master__/admin-tools-replay'),{
    status:200,body:{success:true,data:{id:'PCAT-000017',name:'Tools'}}
  });
  assert.equal((await call('/__m04_master__/different-actor-replay')).status,409);
  assert.deepEqual(await state(),before);
});
test('current literal staff grant creates PUNT while false/string grants cannot read master or burn ID',async()=>{
  assert.deepEqual(await call('/__m04_master__/staff-unit'),{
    status:200,body:{success:true,data:{id:'PUNT-000008',name:'গিরা'}}
  });
  const before=await state();
  assert.deepEqual(await call('/__m04_master__/denied'),{
    status:409,body:{error:'Authorized master mutation refused'}
  });
  assert.equal((await call('/__m04_master__/string-grant')).status,409);
  assert.deepEqual(await state(),before);
});
test('authorized inactive source duplicates clean up atomically and preserve unaffected row positions',async()=>{
  assert.deepEqual(await call('/__m04_master__/inactive-wire'),{
    status:200,body:{success:true,data:{id:'PCAT-000018',name:'wIrE'}}
  });
  assert.deepEqual((await state()).categories.map(v=>[v.category_id,v.legacy_sheet_row]),[
    ['PCAT-000002',2],['PCAT-000016',3],
    ['PCAT-000017',4],['PCAT-000018',5]
  ]);
});
test('real Workerd D1 serializes concurrent authorized requests for the same name',async()=>{
  const [a,b]=await Promise.all([
    call('/__m04_master__/race-a'),
    call('/__m04_master__/race-b')
  ]);
  assert.equal([a,b].filter(x=>x.status===200&&x.body.success===true).length,1);
  const saved=await state();
  assert.equal(saved.categories.filter(v=>v.category_name.toLowerCase()==='latch').length,1);
  assert.equal(saved.intents.filter(v=>v.operation_id.startsWith('OP-RACE')).length,1);
  assert.equal(saved.counters.find(v=>v.id_key==='PRODUCT_CATEGORIES').current_sequence,19);
});
test('response loss after committed source ID replays as same authenticated actor',async()=>{
  assert.equal((await call('/__m04_master__/admin-lost')).status,503);
  const saved=await state();
  assert.deepEqual(await call('/__m04_master__/admin-lost-retry'),{
    status:200,body:{success:true,data:{id:'PCAT-000020',name:'Tape'}}
  });
  assert.deepEqual(await state(),saved);
});
test('revoking M04 session refuses later authorized Unit creation with zero mutation',async()=>{
  assert.equal((await DB.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?')
    .bind(NOW,hash(token.STAFF)).run()).success,true);
  const before=await state();
  assert.equal((await call('/__m04_master__/staff-revoked')).status,409);
  assert.deepEqual(await state(),before);
});
test('late failure inside original M03 catalog trigger rolls back D1 actor/receipt/counter together',async()=>{
  assert.equal((await DB.prepare("CREATE TRIGGER deny_master_fault BEFORE INSERT ON product_categories "+
    "WHEN NEW.category_name='Fault' BEGIN SELECT RAISE(ABORT,'synthetic late fault'); END").run()).success,true);
  const before=await state();
  assert.equal((await call('/__m04_master__/admin-fault')).status,409);
  assert.deepEqual(await state(),before);
  assert.equal((await DB.prepare('DROP TRIGGER deny_master_fault').run()).success,true);
  assert.deepEqual(await call('/__m04_master__/admin-fault'),{
    status:200,body:{success:true,data:{id:'PCAT-000021',name:'Fault'}}
  });
});
test('test-only route ignores client actor/time/name/SQL and public Worker/RPC never imports writer',async()=>{
  const before=await state();
  assert.equal((await call('/__m04_master__/unknown',{sql:'DROP TABLE auth_users'})).status,404);
  assert.equal((await call('/__m04_master__/admin-tools',undefined,'GET')).status,405);
  assert.deepEqual(await call('/__m04_master__/admin-tools',{
    actorId:'ATTACKER',nowMs:9e12,name:'Evil',token:'forged',sql:'DROP TABLE product_categories'
  }),{status:200,body:{success:true,data:{id:'PCAT-000017',name:'Tools'}}});
  assert.deepEqual(await state(),before);
  const config=JSON.parse(readFileSync(new URL(
    '../../wrangler.m03-m04-authorized-master-test.jsonc',import.meta.url),'utf8'));
  assert.equal(config.workers_dev,false);
  assert.equal(config.routes,undefined);
  assert.equal(config.d1_databases[0].database_id,'00000000-0000-0000-0000-000000000099');
  const live=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  assert(!live.includes('m04-authorized-product-master-create'));
  assert(!live.includes('m03-m04-authorized-master'));
});
