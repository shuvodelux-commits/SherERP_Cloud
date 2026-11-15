import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createSyntheticD1ReversalContract} from './fixtures/m03-reversal-contract.mjs';
import {SYNTHETIC_REVERSAL_SCHEMA,SYNTHETIC_REVERSAL_ORIGINALS,
  SYNTHETIC_REVERSAL_STOCK,SYNTHETIC_REVERSAL_MOVEMENTS} from './fixtures/m03-reversal-schema.mjs';

function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for(const sql of SYNTHETIC_REVERSAL_SCHEMA)db.exec(sql);
  for(const row of SYNTHETIC_REVERSAL_ORIGINALS)db.prepare(
    `INSERT INTO synthetic_original_ops
     (tenant_id,operation_id,sku,units,payload_hash,state,has_return)
     VALUES (?,?,?,?,?,?,?)`).run(...row);
  for(const row of SYNTHETIC_REVERSAL_STOCK)db.prepare(
    'INSERT INTO synthetic_stock(tenant_id,sku,available) VALUES (?,?,?)').run(...row);
  for(const row of SYNTHETIC_REVERSAL_MOVEMENTS)db.prepare(
    `INSERT INTO synthetic_owned_movements(tenant_id,operation_id,sku,units,source_type)
     VALUES (?,?,?,?,?)`).run(...row);
  let batches=0;
  const DB={
    prepare(sql){
      const stmt=db.prepare(sql);
      return {
        bind(...args){return {_all:()=>stmt.all(...args),all:async()=>({success:true,results:stmt.all(...args)})};},
        _all:()=>stmt.all()
      };
    },
    async batch(statements){
      batches++;
      db.exec('BEGIN IMMEDIATE');
      try{
        const result=statements.map(statement=>({
          success:true,results:statement._all()
        }));
        db.exec('COMMIT');
        return result;
      }catch(error){db.exec('ROLLBACK');throw error;}
    }
  };
  return {db,DB,contract:createSyntheticD1ReversalContract(DB),
    batches:()=>batches,close:()=>db.close()};
}
const intent=(patch={})=>({
  tenantId:'TENANT-1',
  actorId:'STAFF-1',
  reversalId:'REV-ONE',
  originalOperationId:'OP-OWN',
  originalHash:'a'.repeat(64),
  units:1,
  reason:'Approved invoice deletion',
  ...patch
});
function snapshot(db){
  return {
    stock:db.prepare('SELECT tenant_id,sku,available FROM synthetic_stock ORDER BY tenant_id,sku').all()
      .map(x=>({...x})),
    reversals:db.prepare(`SELECT tenant_id,reversal_id,original_operation_id,actor_id,
     original_hash,reversal_hash,units,reason,sku,result_ref
     FROM synthetic_reversals ORDER BY tenant_id,reversal_id`).all().map(x=>({...x})),
    movements:db.prepare(`SELECT tenant_id,reversal_id,original_operation_id,sku,units
     FROM synthetic_reverse_movements ORDER BY tenant_id,reversal_id`).all().map(x=>({...x}))
  };
}

test('first proven owned-stock reversal commits once and creates inverse movement with original identity',async()=>{
  const x=fixture();
  try{
    assert.deepEqual(await x.contract.reverse(intent()),{
      status:'REVERSED',reversalId:'REV-ONE',resultRef:'REV-ONE'});
    const state=snapshot(x.db);
    assert.equal(state.stock.find(s=>s.tenant_id==='TENANT-1'&&s.sku==='PIPE').available,1);
    assert.equal(state.reversals.length,1);
    assert.equal(state.movements.length,1);
    assert.deepEqual(state.movements[0],{
      tenant_id:'TENANT-1',reversal_id:'REV-ONE',
      original_operation_id:'OP-OWN',sku:'PIPE',units:1
    });
    assert.equal(state.reversals[0].actor_id,'STAFF-1');
    assert.equal(state.reversals[0].original_hash,'a'.repeat(64));
    assert.equal(x.batches(),1);
  }finally{x.close();}
});

test('identical replay returns original reference without another stock restoration',async()=>{
  const x=fixture();
  try{
    await x.contract.reverse(intent());
    const before=snapshot(x.db);
    assert.deepEqual(await x.contract.reverse(intent()),{
      status:'REPLAY',reversalId:'REV-ONE',resultRef:'REV-ONE'});
    assert.deepEqual(snapshot(x.db),before);
  }finally{x.close();}
});

test('changed reason, actor, original hash or units under same reversal ID is a conflict',async()=>{
  const x=fixture();
  try{
    await x.contract.reverse(intent());
    const before=snapshot(x.db);
    for(const patch of [
      {reason:'Changed approval'},
      {actorId:'STAFF-2'},
      {originalHash:'b'.repeat(64)},
      {units:2},
      {originalOperationId:'OP-RETURN'}
    ]){
      assert.deepEqual(await x.contract.reverse(intent(patch)),{
        status:'CONFLICT',reversalId:'REV-ONE'
      });
    }
    assert.deepEqual(snapshot(x.db),before);
  }finally{x.close();}
});

test('a second reversal ID against one original operation conflicts, never double restores',async()=>{
  const x=fixture();
  try{
    await x.contract.reverse(intent());
    const before=snapshot(x.db);
    assert.deepEqual(await x.contract.reverse(intent({reversalId:'REV-TWO'})),{
      status:'CONFLICT',reversalId:'REV-TWO'
    });
    assert.deepEqual(snapshot(x.db),before);
  }finally{x.close();}
});

test('two concurrent reversal IDs for same original produce one reversal and one conflict',async()=>{
  const x=fixture();
  try{
    const results=await Promise.all([
      x.contract.reverse(intent({reversalId:'REV-A'})),
      x.contract.reverse(intent({reversalId:'REV-B'}))
    ]);
    assert.deepEqual(results.map(x=>x.status).sort(),['CONFLICT','REVERSED']);
    const state=snapshot(x.db);
    assert.equal(state.reversals.length,1);
    assert.equal(state.movements.length,1);
    assert.equal(state.stock.find(s=>s.tenant_id==='TENANT-1'&&s.sku==='PIPE').available,1);
  }finally{x.close();}
});

test('same original operation ID can be reversed once independently per tenant',async()=>{
  const x=fixture();
  try{
    await x.contract.reverse(intent());
    assert.deepEqual(await x.contract.reverse(intent({
      tenantId:'TENANT-2',originalHash:'b'.repeat(64)
    })),{
      status:'REVERSED',reversalId:'REV-ONE',resultRef:'REV-ONE'
    });
    const state=snapshot(x.db);
    assert.equal(state.reversals.length,2);
    assert.equal(state.movements.length,2);
    assert.equal(state.stock.find(s=>s.tenant_id==='TENANT-2'&&s.sku==='PIPE').available,1);
  }finally{x.close();}
});

test('unproven source ID, wrong original hash, vendor-only and active-return origin are declined',async()=>{
  const x=fixture();
  try{
    const before=snapshot(x.db);
    for(const patch of [
      {originalOperationId:'OP-NOT-FOUND'},
      {originalHash:'9'.repeat(64)},
      {originalOperationId:'OP-VENDOR',originalHash:'c'.repeat(64)},
      {originalOperationId:'OP-RETURN',originalHash:'d'.repeat(64)},
      {originalOperationId:'OP-UNPROVEN',originalHash:'1'.repeat(64)}
    ]){
      assert.deepEqual(await x.contract.reverse(intent(patch)),{
        status:'DECLINED',reversalId:'REV-ONE'
      });
      assert.deepEqual(snapshot(x.db),before);
    }
  }finally{x.close();}
});

test('missing owned stock aborts SQL trigger and rolls back reversal reservation',async()=>{
  const x=fixture();
  try{
    const before=snapshot(x.db);
    await assert.rejects(()=>x.contract.reverse(intent({
      reversalId:'REV-MISSING',originalOperationId:'OP-MISSING',
      originalHash:'e'.repeat(64)
    })),/synthetic-reversal-stock-missing|SQLITE|D1/i);
    assert.deepEqual(snapshot(x.db),before);
  }finally{x.close();}
});

test('injected journal failure rolls back both the stock increment and reversal row',async()=>{
  const x=fixture();
  try{
    const before=snapshot(x.db);
    await assert.rejects(()=>x.contract.reverse(intent({
      reversalId:'REV-BROKEN',originalOperationId:'OP-BROKEN',
      originalHash:'f'.repeat(64)
    })),/synthetic-reversal-journal-failure|SQLITE|D1/i);
    assert.deepEqual(snapshot(x.db),before);
  }finally{x.close();}
});

test('once committed, reversal and inverse movement cannot be overwritten or deleted',async()=>{
  const x=fixture();
  try{
    await x.contract.reverse(intent());
    assert.throws(()=>x.db.prepare(
      "UPDATE synthetic_reversals SET actor_id='FORGED' WHERE reversal_id='REV-ONE'").run(),
      /immutable/i);
    assert.throws(()=>x.db.prepare(
      "DELETE FROM synthetic_reversals WHERE reversal_id='REV-ONE'").run(),
      /immutable/i);
    assert.throws(()=>x.db.prepare(
      "UPDATE synthetic_reverse_movements SET units=10 WHERE reversal_id='REV-ONE'").run(),
      /immutable/i);
    assert.throws(()=>x.db.prepare(
      "DELETE FROM synthetic_reverse_movements WHERE reversal_id='REV-ONE'").run(),
      /immutable/i);
  }finally{x.close();}
});

test('invalid shapes, tenant, actor, IDs, hashes, fractional units, and missing reason reject before D1',async()=>{
  const x=fixture();
  try{
    const bad=[
      null,[],{},'SQL',
      intent({tenantId:' '}),
      intent({tenantId:'TENANT 1'}),
      intent({actorId:'UNVERIFIED ACTOR'}),
      intent({reversalId:'invalid'}),
      intent({reversalId:'REV!'}),
      intent({originalOperationId:'op-lower'}),
      intent({originalHash:'unknown'}),
      intent({units:0}),
      intent({units:-1}),
      intent({units:1.2}),
      intent({units:1e25}),
      intent({reason:'  '}),
      intent({reason:'X'.repeat(201)}),
      {...intent(),sql:'DELETE FROM synthetic_stock'}
    ];
    const accessor=intent();
    Object.defineProperty(accessor,'reason',{enumerable:true,
      get(){throw new Error('DANGEROUS_GETTER');}});
    bad.push(accessor);
    for(const value of bad){
      await assert.rejects(()=>x.contract.reverse(value),
        /invalid|unsupported|reason|operation|tenant|actor|hash|fingerprint|unit/i);
    }
    assert.equal(x.batches(),0);
  }finally{x.close();}
});

test('malformed D1 batch response never claims reversal success and instructs reconciliation',async()=>{
  assert.throws(()=>createSyntheticD1ReversalContract({}),/D1|batch/i);
  const badPayloads=[null,[],[{}],[
    {success:true,results:[]},
    {success:true,results:[{garbage:1}]}
  ]];
  for(const payload of badPayloads){
    const DB={prepare(){return {bind(){return {}}};},async batch(){return payload;}};
    await assert.rejects(()=>createSyntheticD1ReversalContract(DB).reverse(intent()),
      /NEEDS_REVIEW|result|reconcil/i);
  }
});
