import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {projectReportsBootstrap} from '../src/modules/reports-bootstrap-read.js';
import {createReportsBootstrapD1Reader} from '../src/modules/reports-bootstrap-d1-read.js';

function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE settings (row_id INTEGER PRIMARY KEY, key TEXT NOT NULL, value TEXT NOT NULL)');
  const queries=[];
  const env={DB:{prepare(sql){
    queries.push(sql);
    const statement=db.prepare(sql);
    return {bind(...parameters){
      return {async all(){return {success:true,results:statement.all(...parameters)}}};
    }};
  }}};
  return {db,queries,env};
}

test('reports bootstrap awaits fixed-key D1 Settings and matches source-checked five-field projection',async()=>{
  const t=fixture();
  try{
    t.db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('Shop Name','মেসার্স হার্ডওয়্যার');
    t.db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('Currency Symbol','৳');
    t.db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('JWT_SECRET','DO-NOT-LEAK');
    const result=await createReportsBootstrapD1Reader(t.env).getBootstrap('2026-11-15');
    assert.deepEqual(result,projectReportsBootstrap({'Shop Name':'মেসার্স হার্ডওয়্যার','Currency Symbol':'৳'},'2026-11-15'));
    assert.deepEqual(Object.keys(result),['reportTypes','currencySymbol','shopName','defaultFrom','defaultTo']);
    assert.equal(result.defaultFrom,'2026-11-01');
    assert.equal(JSON.stringify(result).includes('DO-NOT-LEAK'),false);
    assert.equal(t.queries.length,1);
    assert.match(t.queries[0],/^SELECT\b/i);
    assert.match(t.queries[0],/WHERE key IN/i);
    assert.doesNotMatch(t.queries[0],/SELECT\s+\*/i);
    assert.doesNotMatch(t.queries[0],/JWT_SECRET|PASSWORD|TOKEN/i);
    assert.equal(result.reportTypes.some(x=>x instanceof Promise),false);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM settings').get().n,3);
  }finally{t.db.close();}
});

test('absent shop settings use source defaults without returning raw Settings keys',async()=>{
  const t=fixture();
  try{
    const r=await createReportsBootstrapD1Reader(t.env).getBootstrap('2024-02-29');
    assert.deepEqual(r,projectReportsBootstrap({},'2024-02-29'));
    assert.equal(r.currencySymbol,'');
    assert.equal(r.shopName,'Hardware Store ERP');
    assert.equal(r.defaultFrom,'2024-02-01');
  }finally{t.db.close();}
});

test('missing or malformed D1 rejects; never falls back to GAS or an unauthenticated alternate DB',async()=>{
  assert.throws(()=>createReportsBootstrapD1Reader({}),/D1|binding/i);
  assert.throws(()=>createReportsBootstrapD1Reader({DB:{}}),/D1|binding/i);
  const bad={DB:{prepare(){return {bind(){return {async all(){return {success:false,results:[]};}};}};}}};
  await assert.rejects(()=>createReportsBootstrapD1Reader(bad).getBootstrap('2026-11-15'),/D1|settings|result/i);
});

test('duplicate, unsafe, or malformed restricted Settings rows fail closed',async()=>{
  for(const rows of [
    [{key:'Shop Name',value:'A'},{key:'Shop Name',value:'B'}],
    [{key:'JWT_SECRET',value:'private'}],
    [{key:'Shop Name',value:42}],
    [{key:'constructor',value:'danger'}],
  ]){
    const env={DB:{prepare(){return {bind(){return {async all(){return {success:true,results:rows};}};}};}}};
    await assert.rejects(()=>createReportsBootstrapD1Reader(env).getBootstrap('2026-11-15'),/settings|invalid|unsafe|duplicate|D1/i);
  }
});

test('shop-local invalid dates fail before querying D1',async()=>{
  const t=fixture();
  try{
    const reader=createReportsBootstrapD1Reader(t.env);
    for(const day of [undefined,null,'2026-02-30','2025-02-29','2026-11-15T23:00:00Z',42]){
      await assert.rejects(()=>reader.getBootstrap(day),/today|date|trusted/i);
    }
    assert.equal(t.queries.length,0);
  }finally{t.db.close();}
});

test('result types are isolated across requests and no source Settings record is returned',async()=>{
  const t=fixture();
  try{
    const reader=createReportsBootstrapD1Reader(t.env);
    const a=await reader.getBootstrap('2026-11-15');
    a.reportTypes[0].label='changed';
    const b=await reader.getBootstrap('2026-11-15');
    assert.equal(b.reportTypes[0].label,'Sales');
    assert.equal(t.queries.length,2);
  }finally{t.db.close();}
});
