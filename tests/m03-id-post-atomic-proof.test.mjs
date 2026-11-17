import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAtomicSourceIdPostingProof} from '../src/db/atomic-source-id-posting-proof.js';

const HASH='a'.repeat(64);
const opts=patch=>({operationId:'OP-ONE',intentHash:HASH,...patch});
function db({receipt={intent_hash:HASH,issued_sequence:17,prefix:'INV'},
            journal={source_id:'INV-000017',units:1,sku:'PIPE-1'},
            inserted={success:true}}={}){
  const sqls=[],binds=[];
  const DB={prepare(sql){
    sqls.push(sql);
    return {bind(...args){
      binds.push(args);
      return {
        async run(){return inserted;},
        async first(){
          return sqls.length===2?receipt:journal;
        }
      };
    }};
  }};
  return {DB,sqls,binds};
}

test('trusted tenant and non-empty D1 required, no public RPC handler',()=>{
  assert.throws(()=>createAtomicSourceIdPostingProof({},'TENANT-A'),/D1|binding/i);
  for(const tenant of [undefined,null,'','tenant x','TENANT-A;DROP']){
    assert.throws(()=>createAtomicSourceIdPostingProof({DB:db().DB},tenant),/tenant|invalid/i);
  }
});

test('one awaited source SALES claim, receipt and exact scoped journal verify committed post',async()=>{
  const mock=db();
  const actor=createAtomicSourceIdPostingProof({DB:mock.DB},'TENANT-A');
  assert(Object.isFrozen(actor));
  assert.deepEqual(Object.keys(actor),['postSale_']);
  assert.deepEqual(await actor.postSale_(opts()),{
    id:'INV-000017',sequence:17,posted:true
  });
  assert.equal(mock.sqls.length,3);
  assert.match(mock.sqls[0],/^INSERT INTO synthetic_m03_id_receipts/i);
  assert.match(mock.sqls[0],/WHERE tenant_id=\? AND id_key=\? AND prefix=\?/);
  assert.match(mock.sqls[1],/^SELECT receipt\./i);
  assert.match(mock.sqls[2],/^SELECT\b/i);
  assert.match(mock.sqls[2],/synthetic_m03_post_journal/);
  assert.deepEqual(mock.binds,[
    ['TENANT-A','SALES','OP-ONE',HASH,'TENANT-A','SALES','INV'],
    ['TENANT-A','SALES','OP-ONE'],
    ['TENANT-A','OP-ONE']
  ]);
  assert(mock.sqls.every(s=>!s.includes('TENANT-A')&&!s.includes('OP-ONE')));
});

test('missing, malformed, or mismatched D1 journal refuses success after ID claim',async()=>{
  const bad=[
    null,{}, {source_id:'INV-000017',units:2,sku:'PIPE-1'},
    {source_id:'INV-000017',units:1,sku:'CUSTOMER'},
    {source_id:'INV-000016',units:1,sku:'PIPE-1'},
    {source_id:17,units:1,sku:'PIPE-1'}
  ];
  for(const journal of bad){
    const x=db({journal});
    await assert.rejects(()=>createAtomicSourceIdPostingProof({DB:x.DB},'TENANT-A')
      .postSale_(opts()),/post|journal|missing|mismatch|invalid/i);
  }
});

test('invalid or changed source operation input fails closed',async()=>{
  for(const input of [
    opts({operationId:''}),opts({operationId:' OP-ONE'}),
    opts({intentHash:'not-a-hash'}),opts({intentHash:'a'.repeat(63)}),
    opts({intentHash:null})
  ]){
    const x=db();
    await assert.rejects(()=>createAtomicSourceIdPostingProof({DB:x.DB},'TENANT-A')
      .postSale_(input),/operation|intent|hash|invalid/i);
    assert.equal(x.sqls.length,0);
  }
});

test('proof stays internal and does not install migrations, expose RPC, or mutate frontend',()=>{
  const config=JSON.parse(readFileSync(new URL('../wrangler.m03-id-post-test.jsonc',import.meta.url),'utf8'));
  assert.equal(config.workers_dev,false);
  assert.equal(config.routes,undefined);
  assert.equal(config.main,'tests/fixtures/m03-id-post-worker.mjs');
  assert.deepEqual(config.d1_databases.map(d=>d.database_id),
    ['00000000-0000-0000-0000-000000000098']);
  const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  const rpc=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.equal((worker+rpc).includes('atomic-source-id-posting-proof'),false);
  assert.equal((worker+rpc).includes('synthetic_m03_post_journal'),false);
});
