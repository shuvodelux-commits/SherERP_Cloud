import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {SYNTHETIC_M03_M04_AUTHORIZED_MASTER_DDL} from './fixtures/m03-m04-authorized-master-schema.mjs';
import {createM04AuthorizedProductMasterCreator} from '../src/modules/m04-authorized-product-master-create.js';
import {createM03AtomicProductMasterCreator} from '../src/modules/m03-product-master-atomic-create.js';

const CORE=readFileSync(new URL('../migrations/0001_core_catalog.sql',import.meta.url),'utf8');
const AUTH=readFileSync(new URL('./fixtures/m04-auth-migrations/0001_auth_core.sql',import.meta.url),'utf8');
const NOW=1_800_000_000_000;
const T={ADMIN:'a'.repeat(64),STAFF:'b'.repeat(64),DENY:'c'.repeat(64),
  ALT:'d'.repeat(64),STRING:'e'.repeat(64),INVALID:'f'.repeat(64)};
const hash=token=>createHash('sha256').update(Buffer.from(token,'hex')).digest('hex');
const rows=(db,table)=>db.prepare('SELECT * FROM '+table+' ORDER BY 1').all().map(r=>({...r}));
const req=(token,operationId,name,nowMs=NOW)=>({token,nowMs,operationId,name});

function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec(CORE);db.exec(AUTH);
  for(const ddl of SYNTHETIC_M03_M04_AUTHORIZED_MASTER_DDL)db.exec(ddl);
  db.exec("INSERT INTO product_categories(category_id,category_name,status,legacy_sheet_row) VALUES "+
    "('PCAT-000002','Electrical','Active',2),('PCAT-000005','Wire','Inactive',3),"+
    "('PCAT-000006',' wire ','Paused',4),('PCAT-000016','Other','Active',5);"+
    "INSERT INTO product_units(unit_id,unit_name,status,legacy_sheet_row) VALUES "+
    "('PUNT-000007','Pcs','Active',2);"+
    "INSERT INTO synthetic_m03_id_counters(tenant_id,id_key,prefix,current_sequence) VALUES "+
    "('BUS-A','PRODUCT_CATEGORIES','PCAT',16),('BUS-A','PRODUCT_UNITS','PUNT',7);");
  for(const [role,permission] of [
    ['Cashier','{"products":{"add":true}}'],['Viewer','{"products":{"add":false}}'],
    ['StringGrant','{"products":{"add":"true"}}'],['Corrupt','{bad json']
  ]){
    db.prepare("INSERT INTO auth_roles(role_name,status,permissions_json) VALUES(?,'Active',?)")
      .run(role,permission);
  }
  for(const [id,role,phone] of [
    ['ADMIN','Administrator','01710000001'],['STAFF','Cashier','01710000002'],
    ['DENY','Viewer','01710000003'],['ALT','Administrator','01710000004'],
    ['STRING','StringGrant','01710000005'],['INVALID','Corrupt','01710000006']
  ]){
    db.prepare('INSERT INTO auth_users '+
      '(user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations) '+
      "VALUES (?,?,?,?,'Active',?,?,210000)")
      .run(id,'Test '+id,phone,role,'ab'.repeat(32),'cd'.repeat(24));
  }
  for(const [id,token,epoch] of [
    ['ADMIN',T.ADMIN,null],['STAFF',T.STAFF,1],['DENY',T.DENY,1],
    ['ALT',T.ALT,null],['STRING',T.STRING,1],['INVALID',T.INVALID,1]
  ]){
    db.prepare('INSERT INTO auth_sessions '+
      '(token_hash,user_id,user_auth_version,role_auth_version,credential_version,'+
      'created_at_ms,last_activity_at_ms,expires_at_ms) VALUES (?,?,1,?,1,?,?,?)')
      .run(hash(token),id,epoch,NOW-2_000_000,NOW-30_000,NOW+1_000_000);
  }
  const DB={prepare(sql){
    const p=db.prepare(sql);
    return {bind(...args){
      return {
        async first(){return p.get(...args)??null;},
        async all(){return {success:true,results:p.all(...args)};},
        async run(){return {success:true,meta:p.run(...args)};}
      };
    }};
  }};
  const creator=createM04AuthorizedProductMasterCreator({DB},{businessId:'BUS-A'});
  const state=()=>({
    categories:rows(db,'product_categories'),units:rows(db,'product_units'),
    counters:rows(db,'synthetic_m03_id_counters'),
    intents:rows(db,'synthetic_m03_master_intents'),
    receipts:rows(db,'synthetic_m03_id_receipts')
  });
  return {db,DB,creator,state,close:()=>db.close()};
}
test('current Administrator creates PCAT and SQL-derived actor is stamped on immutable receipt',async()=>{
  const x=fixture();try{
    assert.deepEqual(await x.creator.createCategory_(req(T.ADMIN,'OP-ADMIN',' Tools ')),{
      success:true,data:{id:'PCAT-000017',name:'Tools'}
    });
    assert.deepEqual(x.state().intents.map(v=>[v.actor_id,v.result_id]),[['ADMIN','PCAT-000017']]);
    assert.equal(x.state().counters.find(v=>v.id_key==='PRODUCT_CATEGORIES').current_sequence,17);
  }finally{x.close();}
});
test('staff needs literal true products.add for independent PUNT creation',async()=>{
  const x=fixture();try{
    assert.deepEqual(await x.creator.createUnit_(req(T.STAFF,'OP-STAFF',' গিরা ')),{
      success:true,data:{id:'PUNT-000008',name:'গিরা'}
    });
    assert.deepEqual(x.state().intents.map(v=>[v.actor_id,v.result_id]),[['STAFF','PUNT-000008']]);
    assert.equal(x.state().counters.find(v=>v.id_key==='PRODUCT_CATEGORIES').current_sequence,16);
  }finally{x.close();}
});
test('false, string and malformed products.add deny without catalog disclosure or writes',async()=>{
  const x=fixture();try{
    const before=x.state();
    for(const token of [T.DENY,T.STRING,T.INVALID]){
      await assert.rejects(()=>x.creator.createCategory_(req(token,'OP-SECRET','Electrical')),
        /Denied|authorization/i);
      await assert.rejects(()=>x.creator.createCategory_(req(token,'OP-NEW','New Label')),
        /Denied|authorization/i);
      assert.deepEqual(x.state(),before);
    }
  }finally{x.close();}
});
test('revoked, expired, idle and stale authority epochs deny with no source ID effect',async()=>{
  const x=fixture();try{
    x.db.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?')
      .run(NOW,hash(T.STAFF));
    x.db.exec("UPDATE auth_roles SET permissions_json='{}' WHERE role_name='Viewer'");
    x.db.exec("UPDATE auth_users SET credential_version=2 WHERE user_id='ALT'");
    // Expiry is independently tested while this bearer is still recently active.
    const beforeExpiry=x.state();
    await assert.rejects(()=>x.creator.createCategory_(
      req(T.ADMIN,'OP-EXPIRE','Tape',NOW+1_000_001)),/Denied|authorization/i);
    assert.deepEqual(x.state(),beforeExpiry);
    // Idle expiry is independently tested before the absolute expiration.
    x.db.prepare('UPDATE auth_sessions SET last_activity_at_ms=? WHERE token_hash=?')
      .run(NOW-1_800_001,hash(T.ADMIN));
    const before=x.state();
    for(const [token,now,op] of [
      [T.STAFF,NOW,'OP-REVOKE'],[T.ADMIN,NOW,'OP-IDLE'],
      [T.DENY,NOW,'OP-ROLE'],[T.ALT,NOW,'OP-CREDENTIAL']
    ]){
      await assert.rejects(()=>x.creator.createCategory_(req(token,op,'Tape',now)),
        /Denied|authorization/i);
    }
    assert.deepEqual(x.state(),before);
  }finally{x.close();}
});
test('same actor replays stable receipt; another authorized actor cannot replay or disclose it',async()=>{
  const x=fixture();try{
    const first=await x.creator.createCategory_(req(T.ADMIN,'OP-REPLAY','Tools'));
    const before=x.state();
    assert.deepEqual(await x.creator.createCategory_(req(T.ADMIN,'OP-REPLAY',' Tools ')),first);
    await assert.rejects(()=>x.creator.createCategory_(req(T.ALT,'OP-REPLAY','Tools')),
      /Denied|authorization|conflict/i);
    await assert.rejects(()=>x.creator.createCategory_(req(T.ADMIN,'OP-REPLAY','Wrong')),
      /intent|collision/i);
    assert.deepEqual(x.state(),before);
    x.db.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?')
      .run(NOW,hash(T.ADMIN));
    await assert.rejects(()=>x.creator.createCategory_(req(T.ADMIN,'OP-REPLAY','Tools')),
      /Denied|authorization/i);
  }finally{x.close();}
});
test('current authorized staff atomically cleans two inactive Unicode-casefolded names and compacts rows',async()=>{
  const x=fixture();try{
    assert.deepEqual(await x.creator.createCategory_(req(T.STAFF,'OP-WIRE',' wIrE ')),{
      success:true,data:{id:'PCAT-000017',name:'wIrE'}
    });
    assert.deepEqual(x.state().categories.map(v=>[v.category_id,v.legacy_sheet_row]),[
      ['PCAT-000002',2],['PCAT-000016',3],['PCAT-000017',4]
    ]);
  }finally{x.close();}
});
test('session revoked between preliminary read and INSERT is denied in same SQL statement',async()=>{
  const x=fixture();try{
    let once=false;
    const proxy={prepare(sql){
      const p=x.DB.prepare(sql);
      if(!sql.includes('INSERT INTO synthetic_m03_master_intents'))return p;
      return {bind(...args){
        const bound=p.bind(...args);
        return {...bound,async run(){
          if(!once){once=true;x.db.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?')
            .run(NOW,hash(T.ADMIN));}
          return bound.run();
        }};
      }};
    }};
    const writer=createM04AuthorizedProductMasterCreator({DB:proxy},{businessId:'BUS-A'});
    await assert.rejects(()=>writer.createCategory_(req(T.ADMIN,'OP-REVOKED-RACE','Tools')),
      /Denied|authorization/i);
    assert.equal(x.state().intents.length,0);
    assert.equal(x.state().receipts.length,0);
    assert.equal(x.state().counters.find(v=>v.id_key==='PRODUCT_CATEGORIES').current_sequence,16);
  }finally{x.close();}
});
test('late SQL trigger failure rolls back actor receipt, source counter and catalog',async()=>{
  const x=fixture();try{
    x.db.exec("CREATE TRIGGER deny_late BEFORE INSERT ON product_categories "+
      "WHEN NEW.category_name='Fault' BEGIN SELECT RAISE(ABORT,'late master failure'); END");
    const before=x.state();
    await assert.rejects(()=>x.creator.createCategory_(req(T.ADMIN,'OP-FAULT','Fault')),
      /late master failure/i);
    assert.deepEqual(x.state(),before);
    x.db.exec('DROP TRIGGER deny_late');
    assert.deepEqual(await x.creator.createCategory_(req(T.ADMIN,'OP-FAULT','Fault')),
      {success:true,data:{id:'PCAT-000017',name:'Fault'}});
  }finally{x.close();}
});
test('old unguarded M03 creator cannot insert into actor-required authorized schema',async()=>{
  const x=fixture();try{
    await assert.rejects(()=>createM03AtomicProductMasterCreator({DB:x.DB},{businessId:'BUS-A'})
      .createCategory_({operationId:'OP-UNGUARDED',name:'Tools'}),/M04 master actor required/i);
    assert.equal(x.state().intents.length,0);
  }finally{x.close();}
});
test('malformed token, client actor injection and untrusted clock are rejected before D1 writes',async()=>{
  const x=fixture();try{
    const before=x.state();
    for(const patch of [
      {token:'invalid'},{nowMs:-1},{nowMs:NaN},{actorId:'ADMIN'},
      {businessId:'BUS-B'},{operationId:'op lower'}
    ]){
      await assert.rejects(()=>x.creator.createUnit_({...req(T.ADMIN,'OP-VALID','Feet'),...patch}),
        /Invalid|Denied|operation/i);
    }
    assert.throws(()=>createM04AuthorizedProductMasterCreator({DB:x.DB},{businessId:'../'}),/business/i);
    assert.deepEqual(x.state(),before);
  }finally{x.close();}
});
test('no public Worker, RPC handler or production migration activation',()=>{
  const live=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert(!live.includes('m04-authorized-product-master-create'));
  assert(!live.includes('synthetic_m03_master_intents'));
});
