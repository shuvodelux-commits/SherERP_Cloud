import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createD1ExactlyOneBatchGuard} from '../src/db/exactly-one-batch.js';

function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE proof_operations(operation_id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL) STRICT;
    CREATE TABLE proof_stock(sku TEXT PRIMARY KEY, quantity INTEGER NOT NULL CHECK(quantity>=0)) STRICT;
    CREATE TABLE proof_journal(operation_id TEXT PRIMARY KEY, sku TEXT NOT NULL, quantity INTEGER NOT NULL) STRICT;
    INSERT INTO proof_stock(sku,quantity) VALUES('PIPE',2),('WIRE',0);
  `);
  let batches=0;
  const DB={
    prepare(sql){
      const prepared=sqlite.prepare(sql);
      return {bind(...values){return {all:async()=>({success:true,results:prepared.all(...values)}),run:async()=>prepared.run(...values),
        _all:()=>prepared.all(...values)}} ,all:async()=>({success:true,results:prepared.all()}),_all:()=>prepared.all()};
    },
    async batch(statements){
      batches++;
      sqlite.exec('BEGIN IMMEDIATE');
      try{
        const values=statements.map(stmt=>({success:true,results:stmt._all()}));
        sqlite.exec('COMMIT');return values;
      }catch(error){sqlite.exec('ROLLBACK');throw error;}
    }
  };
  return {sqlite,DB,guard:createD1ExactlyOneBatchGuard({DB}),batches:()=>batches,close:()=>sqlite.close()};
}
function steps(db,operationId,sku='PIPE',hash='fingerprint-1',qty=1){
  return [
    db.prepare('INSERT OR IGNORE INTO proof_operations(operation_id,payload_hash) VALUES(?,?)')
      .bind(operationId,hash),
    db.prepare('UPDATE proof_stock SET quantity=quantity-? WHERE sku=? AND quantity>=?')
      .bind(qty,sku,qty),
    db.prepare('INSERT INTO proof_journal(operation_id,sku,quantity) VALUES(?,?,?)')
      .bind(operationId,sku,qty)
  ];
}
function state(sqlite){
  return {
    operations:sqlite.prepare('SELECT operation_id,payload_hash FROM proof_operations ORDER BY operation_id')
      .all().map(r=>[r.operation_id,r.payload_hash]),
    stock:sqlite.prepare('SELECT sku,quantity FROM proof_stock ORDER BY sku')
      .all().map(r=>[r.sku,r.quantity]),
    journal:sqlite.prepare('SELECT operation_id,sku,quantity FROM proof_journal ORDER BY operation_id')
      .all().map(r=>[r.operation_id,r.sku,r.quantity])
  };
}

test('one transaction with exactly-one affected row per statement commits all synthetic effects',async()=>{
  const x=fixture();
  try{
    assert.equal(await x.guard.execute_(steps(x.DB,'OP-1')),undefined);
    assert.deepEqual(state(x.sqlite),{
      operations:[['OP-1','fingerprint-1']],
      stock:[['PIPE',1],['WIRE',0]],
      journal:[['OP-1','PIPE',1]]
    });
    assert.equal(x.batches(),1);
  }finally{x.close();}
});

test('zero-row stock guard throws and rolls back the earlier operation-ID claim',async()=>{
  const x=fixture();
  try{
    const before=state(x.sqlite);
    await assert.rejects(()=>x.guard.execute_(steps(x.DB,'OP-0','WIRE')),
      /json|malformed|abort|guard|change/i);
    assert.deepEqual(state(x.sqlite),before);
  }finally{x.close();}
});

test('same ID replay and same-ID different fingerprint never double-decrement stock',async()=>{
  const x=fixture();
  try{
    await x.guard.execute_(steps(x.DB,'OP-1'));
    const once=state(x.sqlite);
    await assert.rejects(()=>x.guard.execute_(steps(x.DB,'OP-1')),/json|malformed|abort|change/i);
    await assert.rejects(()=>x.guard.execute_(steps(x.DB,'OP-1','PIPE','changed-payload')),/json|malformed|abort|change/i);
    assert.deepEqual(state(x.sqlite),once);
    const receipt=x.sqlite.prepare('SELECT payload_hash FROM proof_operations WHERE operation_id=?').get('OP-1');
    assert.equal(receipt.payload_hash,'fingerprint-1');
  }finally{x.close();}
});

test('failing later journal insertion rolls back claim and stock decrement',async()=>{
  const x=fixture();
  try{
    const before=state(x.sqlite);
    const bad=[
      x.DB.prepare('INSERT OR IGNORE INTO proof_operations(operation_id,payload_hash) VALUES(?,?)').bind('OP-X','hash'),
      x.DB.prepare('UPDATE proof_stock SET quantity=quantity-1 WHERE sku=? AND quantity>0').bind('PIPE'),
      x.DB.prepare('INSERT INTO proof_journal(operation_id,sku,quantity) VALUES(?,?,?)')
        .bind('OP-X','PIPE',null)
    ];
    await assert.rejects(()=>x.guard.execute_(bad),/constraint|not null/i);
    assert.deepEqual(state(x.sqlite),before);
  }finally{x.close();}
});

test('one statement unexpectedly affecting two rows aborts the entire transaction',async()=>{
  const x=fixture();
  try{
    const before=state(x.sqlite);
    await assert.rejects(()=>x.guard.execute_([
      x.DB.prepare('UPDATE proof_stock SET quantity=quantity+1')
    ]),/json|malformed|abort|change/i);
    assert.deepEqual(state(x.sqlite),before);
  }finally{x.close();}
});

test('concurrent attempts to consume the last available unit cannot both commit',async()=>{
  const x=fixture();
  try{
    x.sqlite.exec("UPDATE proof_stock SET quantity=1 WHERE sku='PIPE'");
    const result=await Promise.allSettled([
      x.guard.execute_(steps(x.DB,'OP-A')),
      x.guard.execute_(steps(x.DB,'OP-B'))
    ]);
    assert.deepEqual(result.map(r=>r.status).sort(),['fulfilled','rejected']);
    assert.equal(x.sqlite.prepare("SELECT quantity FROM proof_stock WHERE sku='PIPE'").get().quantity,0);
    assert.equal(x.sqlite.prepare('SELECT COUNT(*) AS n FROM proof_journal').get().n,1);
    assert.equal(x.sqlite.prepare('SELECT COUNT(*) AS n FROM proof_operations').get().n,1);
  }finally{x.close();}
});

test('non-D1/missing batch, raw SQL, empty array and malformed steps fail before D1 transaction',async()=>{
  assert.throws(()=>createD1ExactlyOneBatchGuard({}),/D1|binding/i);
  assert.throws(()=>createD1ExactlyOneBatchGuard({DB:{prepare(){}}}),/batch|transaction/i);
  const x=fixture();
  try{
    for(const steps of [[],null,{},['DELETE FROM proof_stock'],[{}],[{run(){}}]]){
      await assert.rejects(()=>x.guard.execute_(steps),/invalid|prepared|statement|nonempty/i);
    }
    assert.equal(x.batches(),0);
  }finally{x.close();}
});

test('malformed batch response rejects with unknown-outcome advisory, not success',async()=>{
  const DB={prepare(sql){return {all:async()=>({results:[{changed_one:1}]})}},
    async batch(){return [{success:true,results:[]}]}
  };
  const guarded=createD1ExactlyOneBatchGuard({DB});
  await assert.rejects(()=>guarded.execute_([{all(){}}]),/unknown|result|reconcil/i);
});
