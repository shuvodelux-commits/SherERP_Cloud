/** RED→GREEN: signed historical Supplier opening is not a current cash transaction. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {unstable_splitSqlQuery} from 'wrangler';
import {startCleanShopHarness} from '../fixtures/m03-clean-shop-harness.mjs';
import {pilotShopConfiguration} from '../../src/auth/platform-shop-binding.js';
import {createOwnerSupplier,readOwnerSupplierBootstrap,recordOwnerSupplierOpening}
  from '../../src/db/m03-owner-supplier-create.js';
import {readOwnerPilotSupplierPurchaseLedger,readOwnerPilotCashBook}
  from '../../src/db/m03-owner-pilot-ledger-read.js';

const migrationFiles=[
 'migrations/0002_party_identity.sql',
 'staging-migrations/shop-owner-write/0005_owner_supplier_master.sql',
 'staging-migrations/shop-owner-write/0006_owner_mvp_credit_purchase.sql',
 'staging-migrations/shop-owner-write/0007_owner_mvp_cash_sale.sql',
 'staging-migrations/shop-owner-write/0008_owner_mvp_cash_return.sql',
 'staging-migrations/shop-owner-write/0009_owner_mvp_cash_close.sql',
 'staging-migrations/shop-owner-write/0010_owner_supplier_cash_pay.sql',
 'staging-migrations/shop-owner-write/0011_owner_supplier_cash_reconciliation.sql',
 'staging-migrations/shop-owner-write/0012_owner_first_day_cash_opening.sql',
 'staging-migrations/shop-owner-write/0013_owner_supplier_historical_opening.sql'
];
async function migrate(db,withOpenings=true){
 for(const file of migrationFiles.slice(0,withOpenings?undefined:-1)){
  const sql=await readFile(file,'utf8');
  await db.batch(unstable_splitSqlQuery(sql).map(s=>db.prepare(s)));
 }
}
const args=owner=>({token:owner.token,ownerSubject:owner.env.PLATFORM_PILOT_SHOP_ID});
const scope=owner=>pilotShopConfiguration(owner.env);
const input=(name,openingBalance='0')=>({
 operationId:crypto.randomUUID(),name,phone:'',address:'',notes:'',openingBalance
});
const create=(owner,draft)=>createOwnerSupplier(scope(owner),{...args(owner),input:draft});
const add=(owner,supplierId,openingBalance,operationId=crypto.randomUUID())=>
 recordOwnerSupplierOpening(scope(owner),{...args(owner),supplierId,
  openingBalance,operationId});

test('positive payable and negative supplier advance stay gross, with no fabricated Cash Book',async()=>{
 const {ownerA,ownerB,SHOP_A_DB:a,SHOP_B_DB:b,close}=await startCleanShopHarness();
 try{
  await migrate(a);await migrate(b);
  const pay=input('Supplier payable','500.25');
  const advance=input('Supplier advance','-250.50');
  assert.equal((await create(ownerA,pay)).status,'created');
  assert.equal((await create(ownerA,pay)).status,'replayed');
  assert.equal((await create(ownerA,advance)).status,'created');
  const listing=await readOwnerSupplierBootstrap(a);
  assert.equal(listing.suppliers.length,2);
  assert.deepEqual(listing.suppliers.map(s=>[
   s['Opening Balance'],s['Current Due'],s['Supplier Advance']
  ]),[[500.25,500.25,0],[-250.5,0,250.5]]);
  assert.equal((await a.prepare('SELECT COUNT(*) AS n FROM owner_mvp_cash_sessions').first()).n,0);
  assert.equal((await a.prepare('SELECT COUNT(*) AS n FROM owner_mvp_sale_cash_book').first()).n,0);
  assert.equal((await a.prepare('SELECT COUNT(*) AS n FROM owner_mvp_supplier_payment_cash_book').first()).n,0);
  assert.equal((await b.prepare('SELECT COUNT(*) AS n FROM owner_supplier_opening_checkpoints').first()).n,0);
  assert.equal((await create(ownerB,input('Independent supplier','-10.75'))).status,'created');
  assert.equal((await b.prepare('SELECT signed_opening_paisa AS n FROM owner_supplier_opening_checkpoints').first()).n,-1075);
  const ledger=await readOwnerPilotSupplierPurchaseLedger(a,'SUP-000001');
  assert.equal(ledger.currentDuePaisa,50025);
  assert.equal(ledger.openingPayablePaisa,50025);
  assert.equal(ledger.supplierAdvancePaisa,0);
  assert.equal((await readOwnerPilotSupplierPurchaseLedger(a,'SUP-000002')).supplierAdvancePaisa,25050);
  const cashBook=await readOwnerPilotCashBook(a);
  assert.equal(cashBook.receivedPaisa,0);
  assert.equal(cashBook.paidPaisa,0);
 }finally{await close();}
});

test('existing zero Supplier can record exactly one signed opening before operational postings',async()=>{
 const {ownerA,SHOP_A_DB:a,close}=await startCleanShopHarness();
 try{
  await migrate(a,false);
  assert.equal((await create(ownerA,input('Existing zero'))).status,'created');
  const openingSql=await readFile(
    'staging-migrations/shop-owner-write/0013_owner_supplier_historical_opening.sql','utf8');
  await a.batch(unstable_splitSqlQuery(openingSql).map(s=>a.prepare(s)));
  const supplierId='SUP-000001';
  const op=crypto.randomUUID();
  assert.equal((await add(ownerA,supplierId,'-80.25',op)).status,'created');
  assert.equal((await add(ownerA,supplierId,'-80.25',op)).status,'replayed');
  assert.equal((await add(ownerA,supplierId,'+50')).status,'invalid');
  assert.equal((await add(ownerA,supplierId,'-80.251')).status,'invalid');
  assert.equal((await add(ownerA,supplierId,'100')).status,'conflict');
  assert.deepEqual(await a.prepare(
   'SELECT signed_opening_paisa AS n FROM owner_supplier_opening_checkpoints').first(),{n:-8025});
  assert.equal((await a.prepare('SELECT current_due_paisa AS n FROM owner_supplier_master').first()).n,0);
  await assert.rejects(a.prepare(
   'UPDATE owner_supplier_opening_checkpoints SET signed_opening_paisa=10').run(),
   /IMMUTABLE/);
  await assert.rejects(a.prepare('DELETE FROM owner_supplier_opening_checkpoints').run(),
   /IMMUTABLE/);
 }finally{await close();}
});

test('old D1 must fail closed for nonzero opening and never produce a partial Supplier',async()=>{
 const {ownerA,SHOP_A_DB:a,close}=await startCleanShopHarness();
 try{
  await migrate(a,false);
  assert.equal((await create(ownerA,input('Legacy zero'))).status,'created');
  assert.equal((await create(ownerA,input('Cannot add nonzero','400'))).status,'invalid');
  assert.equal((await a.prepare('SELECT COUNT(*) AS n FROM owner_supplier_master').first()).n,1);
  assert.equal((await add(ownerA,'SUP-000001','-10')).status,'unsupported');
 }finally{await close();}
});
