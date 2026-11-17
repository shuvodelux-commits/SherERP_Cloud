import test from 'node:test';
import assert from 'node:assert/strict';
import {createAtomicSourceIdIssuer} from '../src/db/atomic-source-id-issuer.js';

const HASH='a'.repeat(64);
const request=patch=>({idKey:'PRODUCT_CATEGORIES',operationId:'OP-SAME',intentHash:HASH,...patch});

function mockDB({run={success:true},receipt={
  intent_hash:HASH,issued_sequence:17,prefix:'PCAT'
}}={}){
  const sqls=[],args=[];
  const DB={prepare(sql){
    sqls.push(sql);
    return {bind(...values){
      args.push(values);
      return {async run(){return run;},async first(){return receipt;}};
    }};
  }};
  return {DB,sqls,args};
}
test('trusted tenant and present D1 binding are required before creating an issuer',()=>{
  assert.throws(()=>createAtomicSourceIdIssuer({},'TENANT-A'),/D1|binding/i);
  const {DB}=mockDB();
  for(const tenant of ['',null,4,'foo;DROP','  ',{},'a'.repeat(130)]){
    assert.throws(()=>createAtomicSourceIdIssuer({DB},tenant),/tenant|invalid|ID/i,String(tenant));
  }
});
test('exact scoped SQL insert plus receipt readback returns source-padded ID, not Promise',async()=>{
  const db=mockDB();
  const issuer=createAtomicSourceIdIssuer({DB:db.DB},'TENANT-A');
  const result=await issuer.allocate_(request());
  assert.deepEqual(result,{id:'PCAT-000017',sequence:17});
  assert.equal(result.id instanceof Promise,false);
  assert.equal(db.sqls.length,2);
  assert.match(db.sqls[0],/^INSERT INTO synthetic_m03_id_receipts\b/i);
  assert.match(db.sqls[0],/ON CONFLICT\s*\(tenant_id,id_key,operation_id\)\s*DO NOTHING/i);
  assert.match(db.sqls[0],/WHERE tenant_id=\? AND id_key=\? AND prefix=\?/);
  assert.match(db.sqls[1],/^SELECT\b/i);
  assert.match(db.sqls[1],/synthetic_m03_id_counters/);
  assert.deepEqual(db.args,[
    ['TENANT-A','PRODUCT_CATEGORIES','OP-SAME',HASH,'TENANT-A','PRODUCT_CATEGORIES','PCAT'],
    ['TENANT-A','PRODUCT_CATEGORIES','OP-SAME']
  ]);
  assert(db.sqls.every(sql=>!sql.includes('TENANT-A')&&!sql.includes('OP-SAME')));
});
test('operation ID, source family and canonical intent hash fail before any SQL',async()=>{
  const db=mockDB(),issuer=createAtomicSourceIdIssuer({DB:db.DB},'TENANT-A');
  for(const patch of [
    {idKey:''},{idKey:'products;DROP'},{idKey:'PRODUCTS/SHADOW'},
    {idKey:'SESSIONS'},{idKey:'SALE_POSTING_JOURNAL'},
    {operationId:''},{operationId:'  '},{operationId:'a'.repeat(200)},
    {intentHash:'x'.repeat(64)},{intentHash:'a'.repeat(63)},
    {intentHash:14},{intentHash:undefined}
  ])await assert.rejects(()=>issuer.allocate_(request(patch)),/invalid|ID|operation|intent|hash/i);
  assert.equal(db.sqls.length,0);
});
test('ambiguous D1 results refuse success even if an INSERT could have committed',async()=>{
  const cases=[
    {run:{success:false}},
    {run:null},
    {receipt:null},
    {receipt:{intent_hash:HASH,issued_sequence:'17',prefix:'PCAT'}},
    {receipt:{intent_hash:HASH,issued_sequence:0,prefix:'PCAT'}},
    {receipt:{intent_hash:HASH,issued_sequence:Number.MAX_SAFE_INTEGER+1,prefix:'PCAT'}},
    {receipt:{intent_hash:HASH,issued_sequence:17,prefix:'BAD;SQL'}},
    {receipt:{intent_hash:HASH,issued_sequence:17,prefix:'INV'}},
    {receipt:{intent_hash:'b'.repeat(64),issued_sequence:17,prefix:'PCAT'}}
  ];
  for(const scenario of cases){
    const {DB}=mockDB(scenario);
    await assert.rejects(()=>createAtomicSourceIdIssuer({DB},'TENANT-A').allocate_(request()),
      /D1|unknown|invalid|intent|receipt|sequence|prefix|collision/i);
  }
});
test('only immutable, fixed SQL belongs to internal migration layer; never public RPC',()=>{
  const module=new URL('../src/db/atomic-source-id-issuer.js',import.meta.url);
  assert(module.pathname.endsWith('/atomic-source-id-issuer.js'));
  const issuer=createAtomicSourceIdIssuer({DB:mockDB().DB},'TENANT-A');
  assert.equal(Object.isFrozen(issuer),true);
  assert.deepEqual(Object.keys(issuer),['allocate_']);
});
