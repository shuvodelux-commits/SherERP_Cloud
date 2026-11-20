/**
 * M10 independent reconciliation of the REAL M03 clean-Shop credit Purchase ->
 * cash POS, with disposable LOCAL Workerd/D1. No mocks of the Sale writer.
 * This is NOT a Shop migration, historical import or production acceptance.
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {unstable_splitSqlQuery} from 'wrangler';
import {startCleanShopHarness} from '../fixtures/m03-clean-shop-harness.mjs';
import {pilotShopConfiguration} from '../../src/auth/platform-shop-binding.js';
import {createOwnerProduct} from '../../src/db/m03-owner-product-create.js';
import {createOwnerSupplier} from '../../src/db/m03-owner-supplier-create.js';
import {openOwnerCashSession,postOwnerCreditPurchase} from '../../src/db/m03-owner-mvp-purchase.js';
import {postOwnerCashSale} from '../../src/db/m03-owner-mvp-cash-sale.js';
import {auditM10OperationalOwnerSaleD1} from '../../src/migration/m10-operational-owner-sale-parity.js';

const uuid=()=>crypto.randomUUID();
const today=()=>new Date(Date.now()+21600000).toISOString().slice(0,10);
const auth=owner=>({token:owner.token,ownerSubject:owner.env.PLATFORM_PILOT_SHOP_ID});
const scope=owner=>pilotShopConfiguration(owner.env);
const expected=owner=>({
  shopId:owner.env.PLATFORM_PILOT_SHOP_ID,
  databaseId:owner.env.PLATFORM_PILOT_D1_ID,
  marker:owner.env.PLATFORM_PILOT_MARKER
});
const sale=qty=>({
  customerId:'',customerName:'Local Counter',customerPhone:'01710000001',
  customerFatherName:'',customerRelationType:'',customerAddress:'',
  items:[{productId:'PRD-000001',name:'M10 Copper Wire',qty,unitPrice:75,
    priceMode:'auto',shortageResolution:'negative',bundleRevision:0,productType:'Standard'}],
  discount:0,paymentType:'Cash',paidAmount:qty*75,paymentMethod:'Cash',bankAccountId:''
});
async function install(db){
  for(const path of [
    'migrations/0002_party_identity.sql',
    'staging-migrations/shop-owner-write/0005_owner_supplier_master.sql',
    'staging-migrations/shop-owner-write/0006_owner_mvp_credit_purchase.sql',
    'staging-migrations/shop-owner-write/0007_owner_mvp_cash_sale.sql'
  ]){
    const sql=await readFile(path,'utf8');
    await db.batch(unstable_splitSqlQuery(sql).map(s=>db.prepare(s)));
  }
}
async function purchase(owner,units){
  return postOwnerCreditPurchase(scope(owner),{...auth(owner),operationId:uuid(),
    payload:{
      supplierId:'SUP-000001',date:today(),backdatedReason:'',
      items:[{productId:'PRD-000001',name:'M10 Copper Wire',
        qty:String(units),unitPrice:'60.00',sellingPrice:'75.00'}],
      discount:'0',paidAmount:'0',paymentMethod:'Cash',bankAccountId:'',notes:'M10 real D1'
    }
  });
}
async function start(owner){
  assert.equal((await createOwnerProduct(scope(owner),{...auth(owner),input:{
    operationId:uuid(),name:'M10 Copper Wire',unit:'pcs',category:'Electrical',brand:'',
    purchasePrice:'60.00',sellingPrice:'75.00',stock:'0',minStock:'0',
    barcode:'',productType:'Standard',components:[]
  }})).status,'created');
  assert.equal((await createOwnerSupplier(scope(owner),{...auth(owner),input:{
    operationId:uuid(),name:'M10 Supplier',phone:'01710000000',
    openingBalance:'0',address:'',notes:''
  }})).status,'created');
  assert.equal((await openOwnerCashSession(scope(owner),{
    ...auth(owner),operationId:uuid(),openingCash:'0',notes:'M10 parity'
  })).status,'started');
}
const post=(owner,qty,op=uuid())=>postOwnerCashSale(scope(owner),{
  ...auth(owner),operationId:op,payload:sale(qty),shopName:'Local M10 Shop'
});

test('M10: independent real Shop D1 readback conserves two credit purchases, two POS sales, FIFO lots, Cash Book and Supplier payable',async()=>{
  const h=await startCleanShopHarness();
  try{
    await install(h.SHOP_A_DB);await install(h.SHOP_B_DB);
    await start(h.ownerA);await start(h.ownerB);
    assert.equal((await purchase(h.ownerA,10)).status,'created');
    assert.equal((await purchase(h.ownerA,5)).status,'created');
    assert.equal((await purchase(h.ownerB,3)).status,'created');
    const op=uuid();
    assert.equal((await post(h.ownerA,2,op)).status,'created');
    assert.equal((await post(h.ownerA,2,op)).status,'replayed');
    assert.equal((await post(h.ownerA,3)).status,'created');
    const report=await auditM10OperationalOwnerSaleD1({DB:h.SHOP_A_DB,...expected(h.ownerA)});
    assert.equal(report.phase,'M10_LOCAL_OPERATIONAL_CASH_SALE_CONSERVATION');
    assert.equal(report.operationalSaleConserved,true);
    assert.deepEqual(report.issues,[]);
    assert.equal(report.invoicesChecked,2);
    assert.equal(report.lotsChecked,2);
    assert.equal(report.productionReady,false);
    assert.equal(report.authorizesRemoteD1Write,false);
    assert.equal(report.authorizesCutover,false);
    assert.doesNotMatch(JSON.stringify(report),/M10 Copper|Local Counter|017100|PRD-|SUP-|INV-/);
    const foreign=await auditM10OperationalOwnerSaleD1({
      DB:h.SHOP_A_DB,...expected(h.ownerB)
    });
    assert.equal(foreign.operationalSaleConserved,false);
    assert.ok(foreign.issues.some(x=>x.code==='SHOP_BINDING_MISMATCH'));
    const empty=await auditM10OperationalOwnerSaleD1({DB:h.SHOP_B_DB,...expected(h.ownerB)});
    assert.equal(empty.operationalSaleConserved,false);
    assert.ok(empty.issues.some(x=>x.code==='NO_SALE_RECEIPT'));
  }finally{await h.close();}
});

test('M10: mismatched product stock and corrupted immutable Cash Book are detected by independent Shop D1 reads',async()=>{
  const h=await startCleanShopHarness();
  try{
    await install(h.SHOP_A_DB);await start(h.ownerA);
    assert.equal((await purchase(h.ownerA,5)).status,'created');
    assert.equal((await post(h.ownerA,2)).status,'created');
    const audit=()=>auditM10OperationalOwnerSaleD1({DB:h.SHOP_A_DB,...expected(h.ownerA)});
    assert.equal((await audit()).operationalSaleConserved,true);
    await h.SHOP_A_DB.prepare(
      "UPDATE owner_mvp_product_stock SET quantity_micro=quantity_micro+1000000 WHERE product_id='PRD-000001'"
    ).run();
    let damaged=await audit();
    assert.equal(damaged.operationalSaleConserved,false);
    assert.ok(damaged.issues.some(x=>x.code==='STOCK_LOT_MISMATCH'));
    await h.SHOP_A_DB.prepare(
      "UPDATE owner_mvp_product_stock SET quantity_micro=quantity_micro-1000000 WHERE product_id='PRD-000001'"
    ).run();
    // Fault injection on disposable D1 only: immutable trigger is removed
    // deliberately to show that independent reconciliation catches an actor
    // that has bypassed a financial constraint.
    await h.SHOP_A_DB.prepare('DROP TRIGGER owner_mvp_sale_cash_immutable_update').run();
    await h.SHOP_A_DB.prepare('UPDATE owner_mvp_sale_cash_book SET received_paisa=received_paisa+1').run();
    damaged=await audit();
    assert.equal(damaged.operationalSaleConserved,false);
    assert.ok(damaged.issues.some(x=>x.code==='SALE_CASH_MISMATCH'));
  }finally{await h.close();}
});

test('M10: the auditor only makes one bounded read-only D1 batch and never grants production authority',async()=>{
  const h=await startCleanShopHarness();
  try{
    await install(h.SHOP_A_DB);await start(h.ownerA);
    assert.equal((await purchase(h.ownerA,4)).status,'created');
    assert.equal((await post(h.ownerA,1)).status,'created');
    const sql=[];let batches=0;
    const observed={prepare(text){sql.push(text);return h.SHOP_A_DB.prepare(text);},
      async batch(statements){batches++;return h.SHOP_A_DB.batch(statements);}};
    const result=await auditM10OperationalOwnerSaleD1({DB:observed,...expected(h.ownerA)});
    assert.equal(result.operationalSaleConserved,true);
    assert.equal(batches,1);
    assert.ok(sql.length>=8 && sql.length<=12);
    assert.ok(sql.every(q=>/^\s*SELECT\b/i.test(q)));
    assert.ok(sql.every(q=>/\bLIMIT\s+1001\b/i.test(q)));
    assert.ok(sql.every(q=>!/\b(INSERT|UPDATE|DELETE|DROP|CREATE|ATTACH|DETACH|PRAGMA)\b/i.test(q)));
    for(const flag of ['productionReady','authorizesRemoteD1Write','authorizesCutover'])
      assert.equal(result[flag],false);
  }finally{await h.close();}
});
