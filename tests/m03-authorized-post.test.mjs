import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {AUTHORIZED_POST_DDL,AUTHORIZED_POST_TENANTS}
  from './fixtures/m03-authorized-post-schema.mjs';
import {createSyntheticAuthorizedPostingContract}
  from './fixtures/m03-authorized-post-contract.mjs';

function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for(const sql of AUTHORIZED_POST_DDL)sqlite.exec(sql);
  for(const [tenant,user,role,token,qty] of AUTHORIZED_POST_TENANTS){
    sqlite.prepare(`INSERT INTO synthetic_post_roles
      (tenant_id,role_id,status,auth_version,can_post)
      VALUES (?,?,'Active',1,1)`).run(tenant,role);
    sqlite.prepare(`INSERT INTO synthetic_post_users
      (tenant_id,user_id,role_id,status,auth_version)
      VALUES (?,?,?,'Active',1)`).run(tenant,user,role);
    sqlite.prepare(`INSERT INTO synthetic_post_sessions
      (token_hash,tenant_id,user_id,role_id,user_version,role_version,expires_at,revoked_at)
      VALUES (?,?,?,?,1,1,2000,NULL)`).run(token,tenant,user,role);
    sqlite.prepare(`INSERT INTO synthetic_post_stock(tenant_id,sku,available)
      VALUES (?,'PIPE-1',?)`).run(tenant,qty);
  }
  sqlite.prepare(`INSERT INTO synthetic_post_users
    (tenant_id,user_id,role_id,status,auth_version)
    VALUES ('TENANT-A','USER-OTHER','ROLE-A','Active',1)`).run();
  sqlite.prepare(`INSERT INTO synthetic_post_sessions
    (token_hash,tenant_id,user_id,role_id,user_version,role_version,expires_at,revoked_at)
    VALUES (?,'TENANT-A','USER-OTHER','ROLE-A',1,1,2000,NULL)`).run('f'.repeat(64));
  let batches=0,sqls=[];
  const DB={
    prepare(sql){
      sqls.push(sql);
      const statement=sqlite.prepare(sql);
      return {bind(...params){return {_all:()=>statement.all(...params)}}};
    },
    async batch(statements){
      batches++;
      sqlite.exec('BEGIN IMMEDIATE');
      try{
        const results=statements.map(s=>({success:true,results:s._all()}));
        sqlite.exec('COMMIT');
        return results;
      }catch(error){sqlite.exec('ROLLBACK');throw error;}
    }
  };
  return {sqlite,DB,contract:createSyntheticAuthorizedPostingContract(DB),
    batches:()=>batches,sqls:()=>sqls,close:()=>sqlite.close()};
}
const request=(patch={})=>({tokenHash:'a'.repeat(64),tenantId:'TENANT-A',
  actorId:'USER-A',operationId:'OP-1',units:1,amount:'120.00',now:1000,...patch});
const otherTenant=(tenant,user,digest,more={})=>request({
  tenantId:tenant,actorId:user,tokenHash:digest.repeat(64),...more});
function snapshot(x){
  return {
    stock:x.sqlite.prepare('SELECT tenant_id,sku,available FROM synthetic_post_stock ORDER BY tenant_id').all().map(z=>({...z})),
    receipts:x.sqlite.prepare(`SELECT tenant_id,operation_id,actor_id,operation_type,payload_hash,units,amount,result_ref
      FROM synthetic_auth_post_receipts ORDER BY tenant_id,operation_id`).all().map(z=>({...z})),
    movement:x.sqlite.prepare(`SELECT tenant_id,operation_id,sku,units
      FROM synthetic_post_movements ORDER BY tenant_id,operation_id`).all().map(z=>({...z}))
  };
}
const qty=(state,tenant)=>state.stock.find(z=>z.tenant_id===tenant)?.available;

test('atomic session-authorized claim produces one immutable receipt, stock delta and movement',async()=>{
  const x=fixture();try{
    assert.deepEqual(await x.contract.post(request()),{
      status:'COMMITTED',operationId:'OP-1',resultRef:'OP-1'});
    const s=snapshot(x);
    assert.equal(qty(s,'TENANT-A'),1);
    assert.equal(qty(s,'TENANT-B'),2);
    assert.equal(s.receipts.length,1);
    assert.equal(s.receipts[0].actor_id,'USER-A');
    assert.equal(s.receipts[0].operation_type,'sales.post');
    assert.equal(s.receipts[0].payload_hash.length,64);
    assert.equal(s.movement.length,1);
    assert.deepEqual(s.movement[0],{tenant_id:'TENANT-A',operation_id:'OP-1',sku:'PIPE-1',units:1});
    assert.equal(x.batches(),1);
    assert.match(x.sqls()[0],/INSERT INTO synthetic_auth_post_receipts/);
    assert.match(x.sqls()[0],/synthetic_post_sessions/);
    assert.match(x.sqls()[0],/auth_version/);
    assert.match(x.sqls()[0],/can_post=1/);
  }finally{x.close();}
});

test('identical operation and actor replay cannot post twice even if enough stock remains',async()=>{
  const x=fixture();try{
    await x.contract.post(request());
    const before=snapshot(x);
    assert.deepEqual(await x.contract.post(request()),{
      status:'REPLAY',operationId:'OP-1',resultRef:'OP-1'});
    assert.deepEqual(snapshot(x),before);
  }finally{x.close();}
});

test('changed amount or quantity reusing ID conflicts and cannot change stock/receipt',async()=>{
  const x=fixture();try{
    await x.contract.post(request());
    const before=snapshot(x);
    for(const patch of [{amount:'120.01'},{units:2}]){
      assert.deepEqual(await x.contract.post(request(patch)),{
        status:'CONFLICT',operationId:'OP-1'});
      assert.deepEqual(snapshot(x),before);
    }
  }finally{x.close();}
});

test('forged actor and wrong tenant cannot claim or see receipt; legitimate other actor cannot reveal owner',async()=>{
  const x=fixture();try{
    await x.contract.post(request());
    const before=snapshot(x);
    for(const bad of [
      request({actorId:'USER-OTHER'}),
      request({tokenHash:'f'.repeat(64),actorId:'USER-OTHER'}),
      request({tenantId:'TENANT-B'}),
      request({tokenHash:'b'.repeat(64),tenantId:'TENANT-A'})
    ]){
      assert.deepEqual(await x.contract.post(bad),{status:'DECLINED',operationId:'OP-1'});
      assert.deepEqual(snapshot(x),before);
    }
  }finally{x.close();}
});

test('identical stable operation IDs across two tenants are independent, without cross-tenant receipts',async()=>{
  const x=fixture();try{
    await x.contract.post(request());
    assert.deepEqual(await x.contract.post(otherTenant('TENANT-B','USER-B','b')),{
      status:'COMMITTED',operationId:'OP-1',resultRef:'OP-1'});
    const s=snapshot(x);
    assert.equal(s.receipts.length,2);
    assert.equal(qty(s,'TENANT-A'),1);
    assert.equal(qty(s,'TENANT-B'),1);
    assert.notEqual(s.receipts[0].payload_hash,s.receipts[1].payload_hash);
  }finally{x.close();}
});

test('revoked, expired and role-disabled authority refuses even an existing replay',async()=>{
  for(const mutate of [
    (db)=>db.prepare(`UPDATE synthetic_post_sessions SET revoked_at=900
      WHERE token_hash=?`).run('a'.repeat(64)),
    (db)=>db.prepare(`UPDATE synthetic_post_sessions SET expires_at=1000
      WHERE token_hash=?`).run('a'.repeat(64)),
    (db)=>db.prepare(`UPDATE synthetic_post_roles SET can_post=0
      WHERE tenant_id='TENANT-A'`).run()
  ]){
    const x=fixture();try{
      await x.contract.post(request());
      const before=snapshot(x);
      mutate(x.sqlite);
      assert.deepEqual(await x.contract.post(request()),{
        status:'DECLINED',operationId:'OP-1'});
      assert.deepEqual(snapshot(x),before);
    }finally{x.close();}
  }
});

test('authority revocation and role/user version invalidation before claim does not reserve receipt',async()=>{
  for(const sql of [
    "UPDATE synthetic_post_sessions SET revoked_at=900 WHERE token_hash='"+'a'.repeat(64)+"'",
    "UPDATE synthetic_post_sessions SET expires_at=1000 WHERE token_hash='"+'a'.repeat(64)+"'",
    "UPDATE synthetic_post_roles SET can_post=0 WHERE tenant_id='TENANT-A'",
    "UPDATE synthetic_post_roles SET status='Inactive' WHERE tenant_id='TENANT-A'",
    "UPDATE synthetic_post_users SET status='Inactive' WHERE tenant_id='TENANT-A' AND user_id='USER-A'",
    "UPDATE synthetic_post_users SET auth_version=auth_version+1 WHERE tenant_id='TENANT-A' AND user_id='USER-A'"
  ]){
    const x=fixture();try{
      x.sqlite.exec(sql);
      const before=snapshot(x);
      assert.deepEqual(await x.contract.post(request()),{status:'DECLINED',operationId:'OP-1'});
      assert.deepEqual(snapshot(x),before);
    }finally{x.close();}
  }
});

test('disabled then re-enabled role or user never resurrects previous posting session',async()=>{
  for(const table of ['synthetic_post_roles','synthetic_post_users']){
    const x=fixture();try{
      const condition=table.endsWith('roles')?"tenant_id='TENANT-A'":"tenant_id='TENANT-A' AND user_id='USER-A'";
      x.sqlite.exec(`UPDATE ${table} SET status='Inactive' WHERE ${condition}`);
      x.sqlite.exec(`UPDATE ${table} SET status='Active' WHERE ${condition}`);
      assert.deepEqual(await x.contract.post(request()),{status:'DECLINED',operationId:'OP-1'});
      assert.equal(snapshot(x).receipts.length,0);
    }finally{x.close();}
  }
});

test('concurrent two operation IDs contend for last unit and only one commits',async()=>{
  const x=fixture();try{
    const a=otherTenant('TENANT-D','USER-D','d',{operationId:'OP-RACE-A'});
    const b={...a,operationId:'OP-RACE-B'};
    const out=await Promise.all([x.contract.post(a),x.contract.post(b)]);
    assert.deepEqual(out.map(z=>z.status).sort(),['COMMITTED','DECLINED']);
    const s=snapshot(x);
    assert.equal(qty(s,'TENANT-D'),0);
    assert.equal(s.receipts.length,1);
    assert.equal(s.movement.length,1);
  }finally{x.close();}
});

test('insufficient synthetic stock cannot claim operation ID or write a movement',async()=>{
  const x=fixture();try{
    const before=snapshot(x);
    assert.deepEqual(await x.contract.post(request({units:3})),{
      status:'DECLINED',operationId:'OP-1'});
    assert.deepEqual(snapshot(x),before);
  }finally{x.close();}
});

test('late movement failure atomically rolls back stock, receipt and journal evidence',async()=>{
  const x=fixture();try{
    const before=snapshot(x);
    await assert.rejects(()=>x.contract.post(otherTenant('TENANT-E','USER-E','e',{
      operationId:'OP-BAD'
    })),/synthetic posting journal failure|SQLITE|D1/i);
    assert.deepEqual(snapshot(x),before);
  }finally{x.close();}
});

test('receipt and movement are immutable after successful posting',async()=>{
  const x=fixture();try{
    await x.contract.post(request());
    assert.throws(()=>x.sqlite.exec(
      "UPDATE synthetic_auth_post_receipts SET actor_id='FORGED' WHERE operation_id='OP-1'"),
      /immutable/i);
    assert.throws(()=>x.sqlite.exec(
      "DELETE FROM synthetic_auth_post_receipts WHERE operation_id='OP-1'"),/immutable/i);
    assert.throws(()=>x.sqlite.exec(
      "UPDATE synthetic_post_movements SET units=5 WHERE operation_id='OP-1'"),/immutable/i);
    assert.equal(snapshot(x).receipts.length,1);
  }finally{x.close();}
});

test('strict request shape, decimal string and amount validation prevent unsafe D1 operations',async()=>{
  const x=fixture();try{
    const invalid=[
      null,[],{},
      request({tokenHash:'bad'}),request({tenantId:'TENANT A'}),
      request({actorId:'USER A'}),request({now:-1}),
      request({operationId:'lowercase'}),request({operationId:'X'.repeat(65)}),
      request({units:0}),request({units:1.5}),request({amount:120}),
      request({amount:'120.000'}),request({amount:'-5.00'}),
      request({amount:'999999999999999999.00'}),{...request(),sql:'DROP TABLE synthetic_auth_post_receipts'}
    ];
    const getter=request();Object.defineProperty(getter,'actorId',{
      enumerable:true,get(){throw Error('DANGEROUS_GETTER');}});
    invalid.push(getter);
    for(const bad of invalid)await assert.rejects(()=>x.contract.post(bad),/Invalid|unsupported/i);
    assert.equal(x.batches(),0);
  }finally{x.close();}
});

test('unavailable D1 and malformed batch responses never claim committed success',async()=>{
  assert.throws(()=>createSyntheticAuthorizedPostingContract({}),/D1|binding/i);
  const results=[null,[],[{}],[{success:true,results:[]}],
    [{success:true,results:[{operation_id:'OP-1'}]},{success:true,results:[]}],
    [{success:true,results:[]},{success:true,results:[{garbage:1}]}]];
  for(const response of results){
    const DB={prepare(){return {bind(){return {}}}},async batch(){return response}};
    await assert.rejects(()=>createSyntheticAuthorizedPostingContract(DB).post(request()),
      /NEEDS_REVIEW|ambiguous|invalid/i);
  }
});
