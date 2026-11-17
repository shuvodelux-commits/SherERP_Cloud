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
  for(const [business,floor] of [['BUSINESS-A',16],['BUSINESS-B',0]]){
    db.prepare(`INSERT INTO synthetic_m03_g4_sale_counters
      (business_id,id_key,prefix,current_sequence) VALUES(?,'SALES','INV',?)`)
      .run(business,floor);
  }
  db.prepare(`INSERT INTO synthetic_m03_g1_cash_sessions(business_id,session_id,status)
    VALUES('BUSINESS-A','SESSION-1','Open')`).run();
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
    // M04 seals session role versions. Simulate a newly issued session
    // instead of modifying an existing authority snapshot.
    const freshToken='e'.repeat(64);
    const epoch=x.db.prepare("SELECT auth_version FROM auth_roles WHERE role_name='Denied'").get().auth_version;
    x.db.prepare(`INSERT INTO auth_sessions(token_hash,user_id,user_auth_version,
      role_auth_version,credential_version,created_at_ms,last_activity_at_ms,expires_at_ms)
      VALUES(?, 'DENIED',1,?,1,?,?,?)`)
      .run(digest(freshToken),epoch,NOW-600_000,NOW-10_000,NOW+600_000);
    await assert.rejects(()=>x.post.post_(intent(freshToken,'OP-STRING')),/Denied/i);
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
    // Correct authority epoch alone never recreates a removed sales.add grant.
    const freshCashier='f'.repeat(64);
    const cashierEpoch=x.db.prepare("SELECT auth_version FROM auth_roles WHERE role_name='Cashier'").get().auth_version;
    x.db.prepare(`INSERT INTO auth_sessions(token_hash,user_id,user_auth_version,
      role_auth_version,credential_version,created_at_ms,last_activity_at_ms,expires_at_ms)
      VALUES(?, 'CASHIER',1,?,1,?,?,?)`)
      .run(digest(freshCashier),cashierEpoch,NOW-600_000,NOW-10_000,NOW+600_000);
    await assert.rejects(()=>x.post.post_(intent(freshCashier,'OP-DOWNGRADE')),/Denied/i);
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

test('G2 Cash Session is mandatory for a new sale: absent or non-Open session never posts',async()=>{
  for(const status of ['absent','Starting','Closing','Closed']){
    const x=fixture();try{
      if(status==='absent'){
        x.db.exec("DELETE FROM synthetic_m03_g1_cash_sessions WHERE business_id='BUSINESS-A'");
      }else{
        x.db.prepare("UPDATE synthetic_m03_g1_cash_sessions SET status=? WHERE business_id='BUSINESS-A'")
          .run(status);
      }
      const before=x.state();
      assert.deepEqual(await x.post.post_(intent(ADMIN,'OP-CASH-GATE')),{
        status:'DECLINED',operationId:'OP-CASH-GATE'
      });
      assert.deepEqual(x.state(),before);
    }finally{x.close();}
  }
});

test('G2 open session permits sale, closed session cannot post new sale but original receipt still replays',async()=>{
  const x=fixture();try{
    assert.equal((await x.post.post_(intent(ADMIN,'OP-OPEN'))).status,'COMMITTED');
    const original=x.state();
    x.db.exec("UPDATE synthetic_m03_g1_cash_sessions SET status='Closing' WHERE business_id='BUSINESS-A'");
    assert.deepEqual(await x.post.post_(intent(ADMIN,'OP-OPEN')),{
      status:'REPLAY',operationId:'OP-OPEN',resultRef:'SYNTH-OP-OPEN'
    });
    assert.deepEqual(await x.post.post_(intent(ADMIN,'OP-NEW')),{
      status:'DECLINED',operationId:'OP-NEW'
    });
    assert.deepEqual(x.state(),original);
  }finally{x.close();}
});

test('G2 only one Starting/Open/Closing session per business; another business cannot satisfy required session',async()=>{
  const x=fixture();try{
    assert.throws(()=>x.db.prepare(`INSERT INTO synthetic_m03_g1_cash_sessions
      (business_id,session_id,status) VALUES('BUSINESS-A','SESSION-2','Starting')`).run(),/unique|constraint/i);
    x.db.exec("DELETE FROM synthetic_m03_g1_cash_sessions WHERE business_id='BUSINESS-A'");
    x.db.exec("INSERT INTO synthetic_m03_g1_cash_sessions(business_id,session_id,status) VALUES('BUSINESS-B','B-OPEN','Open')");
    assert.deepEqual(await x.post.post_(intent(ADMIN,'OP-CROSS-SESSION')),{
      status:'DECLINED',operationId:'OP-CROSS-SESSION'
    });
    assert.equal(x.state().receipts.length,0);
  }finally{x.close();}
});

test('G2 closes Cash Session between actor read and SQL claim without committing receipt or ledger',async()=>{
  const x=fixture();try{
    let hit=false;
    const proxy={prepare(sql){
      const p=x.DB.prepare(sql);
      if(!sql.includes('INSERT INTO operation_receipts'))return p;
      return {bind(...args){
        const bound=p.bind(...args);
        return {...bound,async first(){
          if(!hit){
            hit=true;
            x.db.exec("UPDATE synthetic_m03_g1_cash_sessions SET status='Closing' WHERE business_id='BUSINESS-A'");
          }
          return bound.first();
        }};
      }};
    }};
    const posting=createM04AtomicG1SaleProof({DB:proxy},{businessId:'BUSINESS-A'});
    const before=x.state();
    assert.deepEqual(await posting.post_(intent(ADMIN,'OP-SESSION-RACE')),{
      status:'DECLINED',operationId:'OP-SESSION-RACE'
    });
    assert.equal(hit,true);
    assert.deepEqual(x.state(),before);
  }finally{x.close();}
});

test('G2 even a direct synthetic receipt INSERT cannot bypass DB Cash Session guard',async()=>{
  const x=fixture();try{
    x.db.exec("UPDATE synthetic_m03_g1_cash_sessions SET status='Closing' WHERE business_id='BUSINESS-A'");
    const before=x.state();
    assert.throws(()=>x.db.prepare(`INSERT INTO operation_receipts(
      tenant_id,operation_id,actor_id,operation_type,payload_hash,result_ref,
      committed_at,sku,units,amount_cents,source_invoice_id)
      VALUES('BUSINESS-A','OP-DIRECT','ADMIN','sales.post',?,'SYNTH-OP-DIRECT',
        '2026-11-17T08:00:00Z','PIPE-1',1,12000,'INV-000017')`).run('a'.repeat(64)),/cash session|required|abort/i);
    assert.deepEqual(x.state(),before);
  }finally{x.close();}
});

test('G3 SQL-atomic commit persists exactly one immutable stock movement and balanced ledger for a stable operation',async()=>{
  const x=fixture();try{
    assert.equal((await x.post.post_(intent(ADMIN,'OP-G3-VALID'))).status,'COMMITTED');
    assert.deepEqual(x.db.prepare(`SELECT business_id,operation_id,sku,units_out
      FROM synthetic_m03_g1_stock_movements ORDER BY operation_id`).all().map(row=>({...row})),[
      {business_id:'BUSINESS-A',operation_id:'OP-G3-VALID',sku:'PIPE-1',units_out:1}
    ]);
    const prior=x.state();
    // Historical stock can legitimately change after this sale.
    x.db.exec("UPDATE synthetic_m03_g1_stock SET available=0 WHERE business_id='BUSINESS-A'");
    assert.deepEqual(await x.post.post_(intent(ADMIN,'OP-G3-VALID')),{status:'REPLAY',
      operationId:'OP-G3-VALID',resultRef:'SYNTH-OP-G3-VALID'});
    assert.deepEqual(x.state().receipts,prior.receipts);
    assert.deepEqual(x.state().journals,prior.journals);
  }finally{x.close();}
});

test('G3 missing original stock movement refuses replay even with intact immutable receipt and balanced journal',async()=>{
  const x=fixture();try{
    await x.post.post_(intent(ADMIN,'OP-G3-LOST-MOVEMENT'));
    x.db.exec('DROP TRIGGER synthetic_m03_g3_movement_immutable_delete');
    x.db.exec("DELETE FROM synthetic_m03_g1_stock_movements WHERE operation_id='OP-G3-LOST-MOVEMENT'");
    const before=x.state();
    await assert.rejects(()=>x.post.post_(intent(ADMIN,'OP-G3-LOST-MOVEMENT')),
      /NEEDS_REVIEW|integrity|movement/i);
    assert.deepEqual(x.state(),before);
  }finally{x.close();}
});

test('G3 missing journal leg fails closed rather than returning REPLAY or posting again',async()=>{
  const x=fixture();try{
    await x.post.post_(intent(ADMIN,'OP-G3-LOST-JOURNAL'));
    x.db.exec('DROP TRIGGER synthetic_m03_g1_journal_immutable_delete');
    x.db.exec("DELETE FROM synthetic_m03_g1_journal WHERE operation_id='OP-G3-LOST-JOURNAL' AND account_kind='sales_revenue'");
    const before=x.state();
    await assert.rejects(()=>x.post.post_(intent(ADMIN,'OP-G3-LOST-JOURNAL')),
      /NEEDS_REVIEW|integrity|journal/i);
    assert.deepEqual(x.state(),before);
  }finally{x.close();}
});

test('G3 altered journal cents fail replay integrity despite matching parent hash',async()=>{
  const x=fixture();try{
    await x.post.post_(intent(ADMIN,'OP-G3-CENTS'));
    x.db.exec('DROP TRIGGER synthetic_m03_g1_journal_immutable_update');
    x.db.exec("UPDATE synthetic_m03_g1_journal SET signed_cents=signed_cents+1 WHERE operation_id='OP-G3-CENTS' AND account_kind='cash'");
    const before=x.state();
    await assert.rejects(()=>x.post.post_(intent(ADMIN,'OP-G3-CENTS')),
      /NEEDS_REVIEW|integrity|journal/i);
    assert.deepEqual(x.state(),before);
  }finally{x.close();}
});

test('G3 stock movement is append-only, and a late movement failure rolls back receipt, stock and cash',async()=>{
  const x=fixture();try{
    await x.post.post_(intent(ADMIN,'OP-G3-IMMUTABLE'));
    assert.throws(()=>x.db.exec("DELETE FROM synthetic_m03_g1_stock_movements"),/immutable/i);
    assert.throws(()=>x.db.exec("UPDATE synthetic_m03_g1_stock_movements SET units_out=3"),/immutable/i);
    x.db.exec(`CREATE TRIGGER synthetic_m03_g3_fail_late BEFORE INSERT ON synthetic_m03_g1_stock_movements
      BEGIN SELECT RAISE(ABORT,'synthetic G3 late movement failure'); END`);
    const before=x.state();
    await assert.rejects(()=>x.post.post_(intent(ADMIN,'OP-G3-LATE')),
      /NEEDS_REVIEW|late movement/i);
    assert.deepEqual(x.state(),before);
  }finally{x.close();}
});

test('G4 source SALES ID is issued with an atomic sale from imported high-water floor and never reissued on replay',async()=>{
  const x=fixture();try{
    const first=await x.post.post_(intent(ADMIN,'OP-G4-1'));
    assert.equal(first.status,'COMMITTED');
    const receipt=x.db.prepare("SELECT source_invoice_id FROM operation_receipts WHERE operation_id='OP-G4-1'").get();
    assert.equal(receipt.source_invoice_id,'INV-000017');
    const count=()=>x.db.prepare("SELECT current_sequence FROM synthetic_m03_g4_sale_counters WHERE business_id='BUSINESS-A'").get().current_sequence;
    assert.equal(count(),17);
    const before=x.state();
    assert.deepEqual(await x.post.post_(intent(ADMIN,'OP-G4-1')),{
      status:'REPLAY',operationId:'OP-G4-1',resultRef:first.resultRef
    });
    assert.equal(count(),17);
    assert.deepEqual(x.state(),before);
    assert.equal((await x.post.post_(intent(ADMIN,'OP-G4-2'))).status,'COMMITTED');
    assert.equal(count(),18);
    assert.equal(x.db.prepare("SELECT source_invoice_id FROM operation_receipts WHERE operation_id='OP-G4-2'").get().source_invoice_id,'INV-000018');
  }finally{x.close();}
});

test('G4 stock shortfall, non-Open session and invalid actor cannot consume any source invoice sequence',async()=>{
  const x=fixture();try{
    const current=()=>x.db.prepare("SELECT current_sequence FROM synthetic_m03_g4_sale_counters WHERE business_id='BUSINESS-A'").get().current_sequence;
    assert.deepEqual(await x.post.post_(intent(ADMIN,'OP-G4-NO-STOCK',{units:3})),{
      status:'DECLINED',operationId:'OP-G4-NO-STOCK'
    });
    x.db.exec("UPDATE synthetic_m03_g1_cash_sessions SET status='Closing' WHERE business_id='BUSINESS-A'");
    assert.deepEqual(await x.post.post_(intent(ADMIN,'OP-G4-CLOSED')),{
      status:'DECLINED',operationId:'OP-G4-CLOSED'
    });
    x.db.exec("UPDATE synthetic_m03_g1_cash_sessions SET status='Open' WHERE business_id='BUSINESS-A'");
    await assert.rejects(()=>x.post.post_(intent(DENY,'OP-G4-DENIED')),/Denied/i);
    assert.equal(current(),16);
    assert.equal(x.state().receipts.length,0);
  }finally{x.close();}
});

test('G4 failed late journal and stock movement reject original INSERT and roll back the ID counter',async()=>{
  const x=fixture();try{
    const before=x.state();
    x.db.exec(`CREATE TRIGGER g4_late_journal_fail BEFORE INSERT ON synthetic_m03_g1_journal
      WHEN NEW.account_kind='sales_revenue'
      BEGIN SELECT RAISE(ABORT,'synthetic G4 journal failed'); END`);
    await assert.rejects(()=>x.post.post_(intent(ADMIN,'OP-G4-ROLLBACK')),/NEEDS_REVIEW/i);
    assert.deepEqual(x.state(),before);
    assert.equal(x.db.prepare("SELECT current_sequence FROM synthetic_m03_g4_sale_counters WHERE business_id='BUSINESS-A'").get().current_sequence,16);
    x.db.exec('DROP TRIGGER g4_late_journal_fail');
    assert.equal((await x.post.post_(intent(ADMIN,'OP-G4-ROLLBACK'))).status,'COMMITTED');
    assert.equal(x.db.prepare("SELECT source_invoice_id FROM operation_receipts WHERE operation_id='OP-G4-ROLLBACK'").get().source_invoice_id,'INV-000017');
  }finally{x.close();}
});

test('G4 one-business source ID counter cannot be borrowed from another business and refuses missing/exhausted counters',async()=>{
  const x=fixture();try{
    x.db.exec("DELETE FROM synthetic_m03_g4_sale_counters WHERE business_id='BUSINESS-A'");
    assert.deepEqual(await x.post.post_(intent(ADMIN,'OP-G4-MISSING')),{
      status:'DECLINED',operationId:'OP-G4-MISSING'
    });
    x.db.exec("INSERT INTO synthetic_m03_g4_sale_counters VALUES('BUSINESS-A','SALES','INV',9007199254740991)");
    assert.deepEqual(await x.post.post_(intent(ADMIN,'OP-G4-EXHAUSTED')),{
      status:'DECLINED',operationId:'OP-G4-EXHAUSTED'
    });
    assert.equal(x.state().receipts.length,0);
    assert.equal(x.db.prepare("SELECT current_sequence FROM synthetic_m03_g4_sale_counters WHERE business_id='BUSINESS-B'").get().current_sequence,0);
  }finally{x.close();}
});

test('G4 distinct concurrent last-unit sales issue one unique invoice ID with no sequence gap',async()=>{
  const x=fixture();try{
    x.db.exec("UPDATE synthetic_m03_g1_stock SET available=1 WHERE business_id='BUSINESS-A'");
    const pair=await Promise.all([
      x.post.post_(intent(ADMIN,'OP-G4-RACE-A')),
      x.post.post_(intent(SECOND,'OP-G4-RACE-B'))
    ]);
    assert.deepEqual(pair.map(x=>x.status).sort(),['COMMITTED','DECLINED']);
    assert.equal(x.db.prepare("SELECT current_sequence FROM synthetic_m03_g4_sale_counters WHERE business_id='BUSINESS-A'").get().current_sequence,17);
    assert.equal(x.db.prepare("SELECT source_invoice_id FROM operation_receipts").get().source_invoice_id,'INV-000017');
    assert.equal(x.state().receipts.length,1);
    assert.equal(x.state().journals.length,2);
  }finally{x.close();}
});

test('G4 direct forged source invoice IDs fail SQL verification; committed invoice reference is immutable',async()=>{
  const x=fixture();try{
    assert.throws(()=>x.db.prepare(`INSERT INTO operation_receipts(
      tenant_id,operation_id,actor_id,operation_type,payload_hash,result_ref,
      committed_at,sku,units,amount_cents,source_invoice_id)
      VALUES('BUSINESS-A','OP-G4-FORGED','ADMIN','sales.post',?,
      'SYNTH-OP-G4-FORGED','2026-11-17T08:00:00Z','PIPE-1',1,12000,'INV-999999')`)
      .run('a'.repeat(64)),/source|invoice|counter|mismatch|abort/i);
    assert.equal(x.state().receipts.length,0);
    assert.equal(x.db.prepare("SELECT current_sequence FROM synthetic_m03_g4_sale_counters WHERE business_id='BUSINESS-A'").get().current_sequence,16);
    assert.equal((await x.post.post_(intent(ADMIN,'OP-G4-VALID'))).status,'COMMITTED');
    assert.throws(()=>x.db.exec("UPDATE operation_receipts SET source_invoice_id='INV-999999'"),/immutable/i);
  }finally{x.close();}
});
