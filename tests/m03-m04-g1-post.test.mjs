import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createM04AtomicG1SaleProof} from '../src/db/m04-atomic-g1-sale-proof.js';
import {M04_RECEIPT_DDL} from './fixtures/m03-m04-receipt-schema.mjs';
import {M03_G1_POST_DDL,M03_G1_NOW as NOW,M03_G1_TOKEN_ADMIN as ADMIN,
  M03_G1_TOKEN_CASHIER as CASHIER,M03_G1_TOKEN_DENY as DENY,
  M03_G1_TOKEN_SECOND as SECOND} from './fixtures/m03-m04-g1-post-schema.mjs';

const AUTH_SQL=readFileSync(new URL('./fixtures/m04-auth-migrations/0001_auth_core.sql',import.meta.url),'utf8');
const digest=token=>createHash('sha256').update(Buffer.from(token,'hex')).digest('hex');
const intent=(token=ADMIN,operationId='OP-1',patch={})=>({
  token,nowMs:NOW,operationId,units:1,amount:'120.00',...patch
});
function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(AUTH_SQL);
  for(const stmt of [...M04_RECEIPT_DDL,...M03_G1_POST_DDL])db.exec(stmt);
  for(const [role,permissions] of [
    ['Cashier','{"sales":{"add":true}}'],
    ['Denied','{"sales":{"add":false}}'],
    ['StringGrant','{"sales":{"add":"true"}}']
  ]){
    db.prepare("INSERT INTO auth_roles(role_name,status,permissions_json) VALUES(?,'Active',?)")
      .run(role,permissions);
  }
  for(const [id,role,phone,token,version] of [
    ['ADMIN','Administrator','01710000001',ADMIN,null],
    ['CASHIER','Cashier','01710000002',CASHIER,1],
    ['DENIED','Denied','01710000003',DENY,1],
    ['SECOND','Administrator','01710000004',SECOND,null]
  ]){
    db.prepare(`INSERT INTO auth_users(user_id,full_name,phone_key,role_name,
      status,password_hash,password_salt,password_iterations)
      VALUES(?,?,?,?,'Active',?,?,210000)`)
      .run(id,'G1 '+id,phone,role,'d'.repeat(64),'e'.repeat(48));
    db.prepare(`INSERT INTO auth_sessions(token_hash,user_id,user_auth_version,
      role_auth_version,credential_version,created_at_ms,last_activity_at_ms,expires_at_ms)
      VALUES(?,?,1,?,1,?,?,?)`)
      .run(digest(token),id,version,NOW-600_000,NOW-10_000,NOW+600_000);
  }
  db.prepare('INSERT INTO synthetic_m03_g1_stock(business_id,sku,available) VALUES(?,?,?)')
    .run('BUSINESS-A','PIPE-1',2);
  db.prepare('INSERT INTO synthetic_m03_g1_stock(business_id,sku,available) VALUES(?,?,?)')
    .run('BUSINESS-B','PIPE-1',5);
  const DB={prepare(sql){
    const statement=db.prepare(sql);
    return {bind(...args){return {
      async first(){return statement.get(...args)??null;},
      async run(){const result=statement.run(...args);return {success:true,meta:{changes:result.changes}};},
      async all(){return {success:true,results:statement.all(...args)};}
    }}};
  }};
  const post=createM04AtomicG1SaleProof({DB},{businessId:'BUSINESS-A'});
  const state=()=>({
    stock:db.prepare('SELECT business_id,sku,available FROM synthetic_m03_g1_stock ORDER BY business_id').all(),
    receipts:db.prepare('SELECT tenant_id,operation_id,actor_id,payload_hash,sku,units,amount_cents FROM operation_receipts ORDER BY operation_id').all(),
    journals:db.prepare('SELECT business_id,operation_id,account_kind,signed_cents FROM synthetic_m03_g1_journal ORDER BY operation_id,account_kind').all()
  });
  return {db,DB,post,state,close:()=>db.close()};
}

test('G1 real M04 Administrator posts immutable receipt, stock and zero-sum cash/revenue in one SQL statement',async()=>{
  const x=fixture();try{
    assert.deepEqual(await x.post.post_(intent()),{
      status:'COMMITTED',operationId:'OP-1',resultRef:'SYNTH-OP-1'
    });
    const s=x.state();
    assert.equal(s.stock[0].available,1);
    assert.equal(s.stock[1].available,5);
    assert.equal(s.receipts.length,1);
    assert.deepEqual([s.receipts[0].actor_id,s.receipts[0].amount_cents,s.receipts[0].units],['ADMIN',12000,1]);
    assert.deepEqual(s.journals.map(v=>[v.account_kind,v.signed_cents]),[
      ['cash',12000],['sales_revenue',-12000]
    ]);
    assert.equal(s.journals.reduce((n,v)=>n+v.signed_cents,0),0);
  }finally{x.close();}
});

test('same canonical intent replays original result without second stock or money movement',async()=>{
  const x=fixture();try{
    const committed=await x.post.post_(intent());
    const before=x.state();
    assert.deepEqual(await x.post.post_(intent()),{
      status:'REPLAY',operationId:'OP-1',resultRef:committed.resultRef
    });
    assert.deepEqual(x.state(),before);
    for(const patch of [{amount:'120.01'},{units:2}]){
      assert.deepEqual(await x.post.post_(intent(ADMIN,'OP-1',patch)),{
        status:'CONFLICT',operationId:'OP-1'
      });
      assert.deepEqual(x.state(),before);
    }
    assert.deepEqual(await x.post.post_(intent(SECOND)),{
      status:'DECLINED',operationId:'OP-1'
    });
  }finally{x.close();}
});

test('current authorized sales.add staff posts, but false grants and malformed grants cannot read stock or write',async()=>{
  const x=fixture();try{
    assert.deepEqual(await x.post.post_(intent(CASHIER,'OP-CASHIER')),{
      status:'COMMITTED',operationId:'OP-CASHIER',resultRef:'SYNTH-OP-CASHIER'
    });
    const before=x.state();
    await assert.rejects(()=>x.post.post_(intent(DENY,'OP-DENIED')),/Denied/i);
    x.db.prepare("UPDATE auth_roles SET permissions_json=? WHERE role_name='Denied'")
      .run('{"sales":{"add":"true"}}');
    // Reissue a session to avoid falsely accepting stale permissions after change.
    x.db.prepare('UPDATE auth_sessions SET role_auth_version=(SELECT auth_version FROM auth_roles WHERE role_name=?) WHERE token_hash=?')
      .run('Denied',digest(DENY));
    await assert.rejects(()=>x.post.post_(intent(DENY,'OP-STRING')),/Denied/i);
    assert.deepEqual(x.state(),before);
  }finally{x.close();}
});

test('no stock and another business stock cannot authorize an operation or consume an ID',async()=>{
  const x=fixture();try{
    assert.deepEqual(await x.post.post_(intent(ADMIN,'OP-INSUFFICIENT',{units:3})),{
      status:'DECLINED',operationId:'OP-INSUFFICIENT'
    });
    assert.equal(x.state().receipts.length,0);
    assert.equal(x.state().journals.length,0);
    assert.equal(x.state().stock[1].available,5);
  }finally{x.close();}
});

test('session revocation, role downgrade, stale role epoch and user disable block posting',async()=>{
  const x=fixture();try{
    x.db.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?')
      .run(NOW,digest(ADMIN));
    await assert.rejects(()=>x.post.post_(intent()),/Denied/i);
    x.db.prepare("UPDATE auth_roles SET permissions_json='{}' WHERE role_name='Cashier'").run();
    await assert.rejects(()=>x.post.post_(intent(CASHIER,'OP-STALE')),/Denied/i);
    x.db.prepare('UPDATE auth_sessions SET role_auth_version=(SELECT auth_version FROM auth_roles WHERE role_name=?) WHERE token_hash=?')
      .run('Cashier',digest(CASHIER));
    await assert.rejects(()=>x.post.post_(intent(CASHIER,'OP-DOWNGRADE')),/Denied/i);
    x.db.prepare("UPDATE auth_users SET status='Inactive' WHERE user_id='SECOND'").run();
    await assert.rejects(()=>x.post.post_(intent(SECOND,'OP-DISABLED')),/Denied/i);
    assert.equal(x.state().receipts.length,0);
  }finally{x.close();}
});

test('revocation between identity read and claim is rechecked by the INSERT itself',async()=>{
  const x=fixture();try{
    let intercepted=false;
    const proxy={prepare(sql){
      const statement=x.DB.prepare(sql);
      if(!sql.includes('INSERT INTO operation_receipts'))return statement;
      return {bind(...args){
        const bound=statement.bind(...args);
        return {...bound,async first(){
          if(!intercepted){
            intercepted=true;
            x.db.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?')
              .run(NOW,digest(ADMIN));
          }
          return bound.first();
        }};
      }};
    }};
    const posting=createM04AtomicG1SaleProof({DB:proxy},{businessId:'BUSINESS-A'});
    const result=await posting.post_(intent());
    assert.deepEqual(result,{status:'DECLINED',operationId:'OP-1'});
    assert.equal(intercepted,true);
    assert.equal(x.state().receipts.length,0);
    assert.equal(x.state().journals.length,0);
    assert.equal(x.state().stock[0].available,2);
  }finally{x.close();}
});

test('late journal constraint failure rolls back receipt, stock and journal entirely',async()=>{
  const x=fixture();try{
    x.db.exec(`CREATE TRIGGER g1_forced_failure BEFORE INSERT ON synthetic_m03_g1_journal
      WHEN NEW.account_kind='sales_revenue'
      BEGIN SELECT RAISE(ABORT,'forced G1 ledger failure'); END`);
    const before=x.state();
    await assert.rejects(()=>x.post.post_(intent()),/NEEDS_REVIEW|forced G1 ledger/i);
    assert.deepEqual(x.state(),before);
    x.db.exec('DROP TRIGGER g1_forced_failure');
    assert.equal((await x.post.post_(intent())).status,'COMMITTED');
  }finally{x.close();}
});

test('strict input rejects client actor, tenant, float, invalid amount and accessors before D1',async()=>{
  const x=fixture();try{
    const before=x.state();
    for(const patch of [
      {actorId:'ADMIN'},{businessId:'BUSINESS-B'},{sku:'WIRE'},
      {units:0},{units:1.5},{amount:120},{amount:'120.001'},
      {amount:'000.00'},{operationId:'../OP'},{token:'bad'},{nowMs:-1}
    ]){
      await assert.rejects(()=>x.post.post_(intent(ADMIN,'OP-INVALID',patch)),/Invalid/i);
    }
    const accessor=intent();
    Object.defineProperty(accessor,'amount',{enumerable:true,get(){throw new Error('accessor executed')}});
    await assert.rejects(()=>x.post.post_(accessor),/Invalid/i);
    assert.deepEqual(x.state(),before);
    assert.throws(()=>createM04AtomicG1SaleProof({DB:x.DB},{businessId:'../'}),/business/i);
  }finally{x.close();}
});

test('readback and immutable journal cannot be forged after committed synthetic posting',async()=>{
  const x=fixture();try{
    await x.post.post_(intent());
    const state=x.state();
    assert.throws(()=>x.db.prepare("UPDATE operation_receipts SET result_ref='FAKE'").run(),/immutable/i);
    assert.throws(()=>x.db.prepare("DELETE FROM synthetic_m03_g1_journal").run(),/immutable/i);
    assert.deepEqual(x.state(),state);
  }finally{x.close();}
});

test('private G1 proof is absent from public RPC, Worker and production migrations',()=>{
  const paths=['../src/index.js','../src/rpc/registry.js','../wrangler.jsonc'];
  const source=paths.map(path=>{try{return readFileSync(new URL(path,import.meta.url),'utf8');}catch{return ''}}).join('\n');
  assert.equal(source.includes('m04-atomic-g1-sale-proof'),false);
  assert.equal(source.includes('synthetic_m03_g1_stock'),false);
});
