/** M03/M08 Supplier Cash payout reconciliation through real local Workerd D1. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {unstable_splitSqlQuery} from 'wrangler';
import {startCleanShopHarness} from '../fixtures/m03-clean-shop-harness.mjs';
import {pilotShopConfiguration} from '../../src/auth/platform-shop-binding.js';
import {createOwnerProduct} from '../../src/db/m03-owner-product-create.js';
import {createOwnerSupplier} from '../../src/db/m03-owner-supplier-create.js';
import {openOwnerCashSession,closeOwnerCashSession,readOwnerCashSession,readOwnerCashOpeningSuggestion,postOwnerCreditPurchase} from '../../src/db/m03-owner-mvp-purchase.js';
import {postOwnerCashSale} from '../../src/db/m03-owner-mvp-cash-sale.js';
import {postOwnerSupplierCashPayment} from '../../src/db/m08-owner-supplier-cash-pay.js';
import {readOwnerPilotCashBook,readOwnerPilotSupplierPurchaseLedger} from '../../src/db/m03-owner-pilot-ledger-read.js';

const files=[
  'migrations/0002_party_identity.sql',
  'staging-migrations/shop-owner-write/0005_owner_supplier_master.sql',
  'staging-migrations/shop-owner-write/0006_owner_mvp_credit_purchase.sql',
  'staging-migrations/shop-owner-write/0007_owner_mvp_cash_sale.sql',
  'staging-migrations/shop-owner-write/0008_owner_mvp_cash_return.sql',
  'staging-migrations/shop-owner-write/0009_owner_mvp_cash_close.sql',
  'staging-migrations/shop-owner-write/0010_owner_supplier_cash_pay.sql'
];
const day=()=>new Date(Date.now()+21600000).toISOString().slice(0,10);
const ctx=owner=>({token:owner.token,ownerSubject:owner.env.PLATFORM_PILOT_SHOP_ID});
const scope=owner=>pilotShopConfiguration(owner.env);
async function migrate(db){
  for(const p of files){
    const sql=await readFile(p,'utf8');
    await db.batch(unstable_splitSqlQuery(sql).map(s=>db.prepare(s)));
  }
}
async function seed(owner){
  const s=scope(owner),auth=ctx(owner);
  assert.equal((await createOwnerProduct(s,{...auth,input:{
    operationId:crypto.randomUUID(),name:'Reconciled Pipe',category:'Pipe',
    brand:'',unit:'pcs',barcode:'',purchasePrice:'60.00',
    sellingPrice:'75.00',stock:'0',minStock:'0',productType:'Standard',components:[]
  }})).status,'created');
  assert.equal((await createOwnerSupplier(s,{...auth,input:{
    operationId:crypto.randomUUID(),name:'Reconciled Supplier',phone:'01712345678',
    openingBalance:'0',address:'',notes:''
  }})).status,'created');
  assert.equal((await openOwnerCashSession(s,{...auth,operationId:crypto.randomUUID(),
    openingCash:'0',notes:'start'})).status,'started');
  assert.equal((await postOwnerCreditPurchase(s,{...auth,operationId:crypto.randomUUID(),payload:{
    supplierId:'SUP-000001',date:day(),backdatedReason:'',
    items:[{productId:'PRD-000001',name:'Reconciled Pipe',qty:'10',
      unitPrice:'60.00',sellingPrice:'75.00'}],
    discount:'0',paidAmount:'0',paymentMethod:'Cash',bankAccountId:'',notes:'stock'
  }})).status,'created');
  assert.equal((await postOwnerCashSale(s,{...auth,operationId:crypto.randomUUID(),
    shopName:'Reconciliation Shop',payload:{
      customerId:'',customerName:'Walk-in',customerPhone:'01712345678',
      customerFatherName:'',customerRelationType:'',customerAddress:'',
      items:[{productId:'PRD-000001',name:'Reconciled Pipe',qty:2,unitPrice:75,
        priceMode:'auto',shortageResolution:'negative',bundleRevision:0,
        productType:'Standard'}],
      discount:0,paymentType:'Cash',paidAmount:150,paymentMethod:'Cash',
      bankAccountId:''
    }
  })).status,'created');
}
async function pay(owner){
  const output=await postOwnerSupplierCashPayment(scope(owner),{...ctx(owner),
    operationId:crypto.randomUUID(),payload:{
      supplierId:'SUP-000001',amount:'100.25',paymentMethod:'Cash',
      bankAccountId:'',notes:'Verified payout',date:day(),backdatedReason:''
    }});
  assert.equal(output.status,'created');
}
test('Supplier Cash Pay appears exactly once in Cash Session, Cash Book and Supplier ledger and closes with physical count',async()=>{
  const {ownerA,ownerB,SHOP_A_DB:a,SHOP_B_DB:b,close}=await startCleanShopHarness();
  try{
    await migrate(a);await migrate(b);
    await seed(ownerA);await seed(ownerB);await pay(ownerA);
    const cash=await readOwnerCashSession(a);
    assert.equal(cash.cashIn,150);
    assert.equal(cash.cashOut,100.25);
    assert.equal(cash.expectedCash,49.75);
    const book=await readOwnerPilotCashBook(a);
    assert.equal(book.receivedPaisa,15000);
    assert.equal(book.paidPaisa,10025);
    assert.equal(book.netPaisa,4975);
    assert.equal(book.entries.filter(x=>x.kind==='Supplier Payment').length,1);
    const ledger=await readOwnerPilotSupplierPurchaseLedger(a,'SUP-000001');
    assert.equal(ledger.currentDuePaisa,49975);
    assert.equal(ledger.entries.filter(x=>x.kind==='Supplier Payment').length,1);
    assert.equal(ledger.entries.filter(x=>x.kind==='Purchase').length,1);
    assert.equal(ledger.entries[0].balancePaisa,49975);
    const other=await readOwnerCashSession(b);
    assert.equal(other.expectedCash,150);
    const result=await closeOwnerCashSession(scope(ownerA),{...ctx(ownerA),
      operationId:crypto.randomUUID(),countedCash:'49.75',notes:'matched counted cash'});
    assert.equal(result.status,'closed');
    assert.equal(result.expected,49.75);
    assert.equal(result.variance,0);
    assert.equal((await readOwnerCashOpeningSuggestion(a)).openingCash,49.75);
    assert.equal((await openOwnerCashSession(scope(ownerA),{...ctx(ownerA),
      operationId:crypto.randomUUID(),openingCash:'49.75',notes:'next day'})).status,'started');
    assert.equal((await readOwnerCashSession(a)).expectedCash,49.75);
  }finally{await close();}
});
