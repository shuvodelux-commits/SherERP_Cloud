import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {unstable_splitSqlQuery} from 'wrangler';
import {pilotShopConfiguration} from '../../src/auth/platform-shop-binding.js';
import {startCleanShopHarness} from '../fixtures/m03-clean-shop-harness.mjs';
import {createOwnerSupplier,readOwnerSupplierBootstrap} from '../../src/db/m03-owner-supplier-create.js';

async function apply(db,path){
  const sql=await readFile(path,'utf8');
  await db.batch(unstable_splitSqlQuery(sql).map(statement=>db.prepare(statement)));
}
async function supplierReady(db){
  await apply(db,'migrations/0002_party_identity.sql');
  await apply(db,'staging-migrations/shop-owner-write/0005_owner_supplier_master.sql');
}
const draft=(name,more={})=>({
  operationId:crypto.randomUUID(),name,phone:'01711111111',address:'',
  notes:'',openingBalance:'0',...more,
});
const save=(owner,input)=>createOwnerSupplier(pilotShopConfiguration(owner.env),{
  token:owner.token,ownerSubject:owner.env.PLATFORM_PILOT_SHOP_ID,input,
});

test('MVP Supplier Quick Add: current Owner writes one Party and one Supplier role, replay-safe on real two-Shop D1',async()=>{
  const {ownerA,ownerB,SHOP_A_DB:a,SHOP_B_DB:b,close}=await startCleanShopHarness();
  try{
    await supplierReady(a);
    await supplierReady(b);
    const input=draft('Local Hardware Supplier');
    assert.deepEqual(await save(ownerA,input),{status:'created',id:'SUP-000001'});
    assert.deepEqual(await save(ownerA,input),{status:'replayed',id:'SUP-000001'});
    assert.deepEqual(await save(ownerA,{...input,name:'Changed name'}),{status:'conflict'});
    assert.deepEqual(await save(ownerA,draft('LOCAL HARDWARE SUPPLIER')),{status:'conflict'});
    assert.deepEqual(await save(ownerA,draft('Unsupported opening',{openingBalance:'200.00'})),{status:'invalid'});
    assert.deepEqual(await save(ownerA,draft('Second supplier')),{status:'created',id:'SUP-000002'});
    assert.deepEqual(await save(ownerB,draft('Local Hardware Supplier')),{status:'created',id:'SUP-000001'},
      'separate Shop D1 must issue its own Supplier sequence');
    const bootstrap=await readOwnerSupplierBootstrap(a);
    assert.equal(bootstrap.suppliers.length,2);
    assert.deepEqual(bootstrap.suppliers.map(s=>[s['Supplier ID'],s['Supplier Name'],s['Opening Balance'],s['Current Due']]),[
      ['SUP-000001','Local Hardware Supplier',0,0],
      ['SUP-000002','Second supplier',0,0]
    ]);
    assert.equal(bootstrap.suppliers[0].Phone,'01711111111');
    assert.deepEqual(bootstrap.bankAccounts,[]);
    assert.equal((await a.prepare('SELECT count(*) AS n FROM parties').first()).n,2);
    assert.equal((await a.prepare("SELECT count(*) AS n FROM party_roles WHERE role='Supplier'").first()).n,2);
    assert.equal((await a.prepare('SELECT count(*) AS n FROM owner_supplier_create_receipts').first()).n,2);
    assert.equal((await b.prepare('SELECT count(*) AS n FROM owner_supplier_create_receipts').first()).n,1);
  }finally{await close();}
});

test('MVP Supplier SQL authority denies swapped Shop and expired lease without writing Party/receipt',async()=>{
  const {ownerA,ownerB,SHOP_A_DB:a,SHOP_B_DB:b,close}=await startCleanShopHarness();
  try{
    await supplierReady(a);
    await supplierReady(b);
    const scopeB=pilotShopConfiguration(ownerB.env);
    assert.deepEqual(await createOwnerSupplier(scopeB,{
      token:ownerA.token,ownerSubject:'fixture-owner-a',input:draft('Cross-Shop attempt'),
    }),{status:'denied'});
    await a.prepare('UPDATE shop_owner_write_grant SET expires_at_ms=? WHERE singleton=1')
      .bind(Date.now()-1000).run();
    assert.deepEqual(await save(ownerA,draft('Expired attempt')),{status:'denied'});
    assert.equal((await a.prepare('SELECT count(*) AS n FROM parties').first()).n,0);
    assert.equal((await a.prepare('SELECT count(*) AS n FROM owner_supplier_create_receipts').first()).n,0);
    assert.deepEqual(await save(ownerB,draft('Healthy Shop')),{status:'created',id:'SUP-000001'});
  }finally{await close();}
});

test('MVP Supplier D1 migration fails on existing Party history rather than guessing a source ID floor',async()=>{
  const {SHOP_A_DB:a,close}=await startCleanShopHarness();
  try{
    await apply(a,'migrations/0002_party_identity.sql');
    await a.prepare("INSERT INTO parties(party_id,display_name,created_at) VALUES ('PTY-OLD','Existing owner','2026-11-20')").run();
    await assert.rejects(supplierReadyLater(a),/CHECK|preflight|constraint/i);
    assert.equal((await a.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='owner_supplier_create_receipts'").first()).n,0);
  }finally{await close();}
});
async function supplierReadyLater(db){
  await apply(db,'staging-migrations/shop-owner-write/0005_owner_supplier_master.sql');
}
