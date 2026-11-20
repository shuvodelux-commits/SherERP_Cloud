import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {unstable_splitSqlQuery} from 'wrangler';
import {startCleanShopHarness} from '../fixtures/m03-clean-shop-harness.mjs';
import {pilotShopConfiguration} from '../../src/auth/platform-shop-binding.js';
import {createOwnerProduct} from '../../src/db/m03-owner-product-create.js';
import {createOwnerSupplier} from '../../src/db/m03-owner-supplier-create.js';
import {openOwnerCashSession,closeOwnerCashSession,
  readOwnerCashSession,readOwnerCashOpeningSuggestion,postOwnerCreditPurchase}
  from '../../src/db/m03-owner-mvp-purchase.js';
import {postOwnerCashSale} from '../../src/db/m03-owner-mvp-cash-sale.js';
import {postOwnerCashReturn} from '../../src/db/m03-owner-mvp-cash-return.js';
import {postOwnerSupplierCashPayment} from '../../src/db/m08-owner-supplier-cash-pay.js';
import {readOwnerPilotCashBook} from '../../src/db/m03-owner-pilot-ledger-read.js';

const paths=[
  'migrations/0002_party_identity.sql',
  'staging-migrations/shop-owner-write/0005_owner_supplier_master.sql',
  'staging-migrations/shop-owner-write/0006_owner_mvp_credit_purchase.sql',
  'staging-migrations/shop-owner-write/0007_owner_mvp_cash_sale.sql',
  'staging-migrations/shop-owner-write/0008_owner_mvp_cash_return.sql',
  'staging-migrations/shop-owner-write/0009_owner_mvp_cash_close.sql',
  'staging-migrations/shop-owner-write/0010_owner_supplier_cash_pay.sql',
];
const scope=o=>pilotShopConfiguration(o.env);
const auth=o=>({token:o.token,ownerSubject:o.env.PLATFORM_PILOT_SHOP_ID});
const date=()=>new Date(Date.now()+6*3600*1000).toISOString().slice(0,10);
async function apply(db,path){
  const source=await readFile(path,'utf8');
  await db.batch(unstable_splitSqlQuery(source).map(part=>db.prepare(part)));
}
async function migrate(db,{reconciled=true}={}){
  for(const path of paths)await apply(db,path);
  if(reconciled)await apply(db,'staging-migrations/shop-owner-write/0011_owner_supplier_cash_reconciliation.sql');
}
const item=()=>({
  operationId:crypto.randomUUID(),name:'Cash Close Pipe',brand:'',
  category:'Pipes',unit:'pcs',purchasePrice:'60.00',sellingPrice:'75.00',
  stock:'0',minStock:'0',barcode:'',productType:'Standard',components:[]
});
const supplier=()=>({
  operationId:crypto.randomUUID(),name:'Close Day Merchant',phone:'01712345678',
  address:'',notes:'',openingBalance:'0'
});
async function setup(owner){
  const shop=scope(owner);
  assert.equal((await createOwnerProduct(shop,{...auth(owner),input:item()})).status,'created');
  assert.equal((await createOwnerSupplier(shop,{...auth(owner),input:supplier()})).status,'created');
  assert.equal((await openOwnerCashSession(shop,{...auth(owner),operationId:crypto.randomUUID(),
    openingCash:'0',notes:'Start Day'})).status,'started');
  const purchase=await postOwnerCreditPurchase(shop,{...auth(owner),operationId:crypto.randomUUID(),
    payload:{supplierId:'SUP-000001',date:date(),backdatedReason:'',
      items:[{productId:'PRD-000001',name:'Cash Close Pipe',qty:'10',
        unitPrice:'60.00',sellingPrice:'75.00'}],
      discount:'0',paidAmount:'0',paymentMethod:'Cash',bankAccountId:'',
      notes:'Received with supplier due'}
  });
  assert.equal(purchase.status,'created');
  const sale=await postOwnerCashSale(shop,{...auth(owner),
    operationId:crypto.randomUUID(),shopName:'Cash Close Shop',
    payload:{customerId:'',customerName:'Cash Customer',customerPhone:'01712345678',
      customerFatherName:'',customerRelationType:'',customerAddress:'',
      items:[{productId:'PRD-000001',name:'Cash Close Pipe',qty:2,unitPrice:75,
        priceMode:'auto',shortageResolution:'negative',bundleRevision:0,
        productType:'Standard'}],
      discount:0,paymentType:'Cash',paidAmount:150,paymentMethod:'Cash',
      bankAccountId:''}
  });
  assert.equal(sale.status,'created');
  return sale.invoice;
}
const pay=(owner,amount='100.25')=>postOwnerSupplierCashPayment(scope(owner),{
  ...auth(owner),operationId:crypto.randomUUID(),
  payload:{supplierId:'SUP-000001',amount,paymentMethod:'Cash',
    bankAccountId:'',notes:'Cash against actual purchase',date:date(),backdatedReason:''}
});
const closeCash=(owner,counted,operationId=crypto.randomUUID())=>
  closeOwnerCashSession(scope(owner),{
    ...auth(owner),operationId,countedCash:counted,notes:'Counted actual drawer'
  });

test('0011 reconciles Supplier Cash Out in Cash Session, Cash Book and counted Close Day without inventing historical Cash In',async()=>{
  const {ownerA,ownerB,SHOP_A_DB:a,SHOP_B_DB:b,close}=await startCleanShopHarness();
  try{
    await migrate(a);await migrate(b);
    await setup(ownerA);
    const original=await readOwnerCashSession(a);
    assert.equal(original.cashIn,150);
    assert.equal(original.cashOut,0);
    assert.equal((await pay(ownerA)).status,'created');
    const session=await readOwnerCashSession(a);
    assert.equal(session.openingCash,0);
    assert.equal(session.cashIn,150);
    assert.equal(session.cashOut,100.25);
    assert.equal(session.expectedCash,49.75);
    const book=await readOwnerPilotCashBook(a);
    assert.equal(book.scope,'cash-sale-return-and-supplier-pay-only');
    assert.deepEqual([book.receivedPaisa,book.paidPaisa,book.netPaisa],[15000,10025,4975]);
    assert.equal(book.entries.length,2);
    assert.deepEqual(book.entries.map(e=>[e.kind,e.reference,e.receivedPaisa,e.paidPaisa])
      .sort((x,y)=>x[0].localeCompare(y[0])),[
      ['Cash Sale','INV-000001',15000,0],
      ['Supplier Payment','SPY-000001',0,10025]
    ]);
    const op=crypto.randomUUID();
    assert.deepEqual(await closeCash(ownerA,'49.75',op),{
      status:'closed',sessionId:'CS-000001',expected:49.75,counted:49.75,variance:0
    });
    assert.deepEqual(await closeCash(ownerA,'49.75',op),{
      status:'replayed',sessionId:'CS-000001',expected:49.75,counted:49.75,variance:0
    });
    assert.equal((await a.prepare('SELECT expected_paisa FROM owner_mvp_cash_sessions').first()).expected_paisa,4975);
    assert.equal((await a.prepare('SELECT counted_paisa FROM owner_mvp_cash_sessions').first()).counted_paisa,4975);
    assert.deepEqual(await readOwnerCashOpeningSuggestion(a),{openingCash:49.75});
    assert.equal((await openOwnerCashSession(scope(ownerA),{...auth(ownerA),
      operationId:crypto.randomUUID(),openingCash:'49.75',notes:'Carry physical count'})).status,'started');
    const next=await readOwnerCashSession(a);
    assert.equal(next.openingCash,49.75);
    assert.equal(next.cashIn,0);
    assert.equal(next.cashOut,0);
    assert.equal(next.expectedCash,49.75);
    assert.equal((await a.prepare('SELECT count(*) AS n FROM owner_mvp_supplier_payment_cash_book').first()).n,1);
    assert.equal((await b.prepare('SELECT count(*) AS n FROM owner_mvp_supplier_payment_cash_book').first()).n,0);
    assert.deepEqual((await readOwnerPilotCashBook(b)).entries,[]);
  }finally{await close();}
});

test('counted variance is an audit fact, not a new Cash Book receipt or expense',async()=>{
  const {ownerA,SHOP_A_DB:a,close}=await startCleanShopHarness();
  try{
    await migrate(a);await setup(ownerA);await pay(ownerA,'100.25');
    const settled=await closeCash(ownerA,'50.00');
    assert.equal(settled.status,'closed');
    assert.equal(settled.expected,49.75);
    assert.equal(settled.counted,50);
    assert.equal(settled.variance,0.25);
    const book=await readOwnerPilotCashBook(a);
    assert.deepEqual([book.receivedPaisa,book.paidPaisa],[15000,10025]);
    assert.equal((await a.prepare('SELECT count(*) AS n FROM owner_mvp_supplier_payment_cash_book').first()).n,1);
    assert.equal((await a.prepare('SELECT count(*) AS n FROM owner_mvp_sale_cash_book').first()).n,1);
    assert.equal((await a.prepare('SELECT count(*) AS n FROM owner_mvp_return_cash_book').first()).n,0);
    assert.equal((await pay(ownerA)).status,'session-required');
  }finally{await close();}
});

test('after a Supplier cash payout, refund cannot exceed current physical cash — failure changes neither cash nor stock',async()=>{
  const {ownerA,SHOP_A_DB:a,close}=await startCleanShopHarness();
  try{
    await migrate(a);
    const invoice=await setup(ownerA);
    assert.equal((await pay(ownerA)).status,'created');
    const refund=()=>postOwnerCashReturn(scope(ownerA),{...auth(ownerA),
      operationId:crypto.randomUUID(),
      payload:{invoiceId:invoice.invoiceId,
        items:[{productId:'PRD-000001',name:'Cash Close Pipe',qty:1,price:75}],
        refundMethod:'Cash',reason:'Customer return',notes:'',
        date:date(),backdatedReason:''}
    });
    assert.equal((await refund()).status,'declined');
    assert.equal((await a.prepare('SELECT count(*) AS n FROM owner_mvp_return_cash_book').first()).n,0);
    assert.equal((await a.prepare('SELECT quantity_micro FROM owner_mvp_product_stock').first()).quantity_micro,8000000);
    assert.equal((await readOwnerCashSession(a)).expectedCash,49.75);
    assert.equal((await closeCash(ownerA,'49.75')).status,'closed');
  }finally{await close();}
});

test('legacy 0010 deliberately denies cash Close; 0011 migration enables only verified full payment-aware calculation',async()=>{
  const {ownerA,SHOP_A_DB:a,close}=await startCleanShopHarness();
  try{
    await migrate(a,{reconciled:false});
    await setup(ownerA);await pay(ownerA);
    assert.equal((await closeCash(ownerA,'49.75')).status,'reconciliation-required');
    assert.equal((await a.prepare('SELECT status FROM owner_mvp_cash_sessions').first()).status,'Open');
    await apply(a,'staging-migrations/shop-owner-write/0011_owner_supplier_cash_reconciliation.sql');
    assert.equal((await closeCash(ownerA,'49.75')).status,'closed');
    assert.equal((await a.prepare('SELECT status FROM owner_mvp_cash_sessions').first()).status,'Closed');
  }finally{await close();}
});

test('migration 0009 pre-Supplier Pay remains source compatible for Sale and Return Cash Session calculations',async()=>{
  const {ownerA,SHOP_A_DB:a,close}=await startCleanShopHarness();
  try{
    for(const path of paths.slice(0,-1))await apply(a,path);
    await setup(ownerA);
    const session=await readOwnerCashSession(a);
    assert.equal(session.cashIn,150);
    assert.equal(session.cashOut,0);
    assert.equal(session.expectedCash,150);
    assert.equal((await closeCash(ownerA,'150.00')).status,'closed');
  }finally{await close();}
});
