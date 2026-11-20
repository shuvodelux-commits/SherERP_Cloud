/**
 * M03 MVP: operational clean-Shop Supplier -> Credit Purchase -> FIFO receipt.
 * This is NOT the full accounting/POS MVP; paid, discounts, mixed units and
 * return/reversal intentionally remain unavailable.
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {unstable_splitSqlQuery} from 'wrangler';
import {pilotShopConfiguration} from '../../src/auth/platform-shop-binding.js';
import {startCleanShopHarness} from '../fixtures/m03-clean-shop-harness.mjs';
import {createOwnerProduct} from '../../src/db/m03-owner-product-create.js';
import {createOwnerSupplier} from '../../src/db/m03-owner-supplier-create.js';
import {openOwnerCashSession,closeOwnerCashSession,
  postOwnerCreditPurchase,readOwnerPurchaseBootstrap,readOwnerPurchaseHistory
} from '../../src/db/m03-owner-mvp-purchase.js';

async function apply(db,path){
  const sql=await readFile(path,'utf8');
  await db.batch(unstable_splitSqlQuery(sql).map(statement=>db.prepare(statement)));
}
async function install(db){
  await apply(db,'migrations/0002_party_identity.sql');
  await apply(db,'staging-migrations/shop-owner-write/0005_owner_supplier_master.sql');
  await apply(db,'staging-migrations/shop-owner-write/0006_owner_mvp_credit_purchase.sql');
}
const scope=owner=>pilotShopConfiguration(owner.env);
const subject=owner=>owner.env.PLATFORM_PILOT_SHOP_ID;
const product=(name='MVP pipe')=>({
  operationId:crypto.randomUUID(),name,brand:'',category:'Pipes',
  unit:'pcs',purchasePrice:'60.00',sellingPrice:'75.00',stock:'0',
  minStock:'0',barcode:'',productType:'Standard',components:[]
});
const supplier=(name='MVP supplier')=>({
  operationId:crypto.randomUUID(),name,phone:'01712345678',
  address:'',notes:'',openingBalance:'0'
});
const date=()=>new Date(Date.now()+6*60*60*1000).toISOString().slice(0,10);
const purchase=(more={})=>({
  supplierId:'SUP-000001',items:[{
    productId:'PRD-000001',name:'MVP pipe',qty:'10',
    unitPrice:'60.00',sellingPrice:'75.00'
  }],discount:'0',paidAmount:'0',paymentMethod:'Cash',bankAccountId:'',
  notes:'MVP stock receiving',date:date(),backdatedReason:'',...more,
});
async function ready(owner){
  const s=scope(owner),token=owner.token,ownerSubject=subject(owner);
  assert.equal((await createOwnerProduct(s,{token,ownerSubject,input:product()})).status,'created');
  assert.deepEqual(await createOwnerSupplier(s,{token,ownerSubject,input:supplier()}),{
    status:'created',id:'SUP-000001'
  });
  return s;
}
const open=(owner,operationId=crypto.randomUUID())=>
  openOwnerCashSession(scope(owner),{
    token:owner.token,ownerSubject:subject(owner),operationId,openingCash:'0',notes:'Start Day'
  });
const post=(owner,input,operationId=crypto.randomUUID())=>
  postOwnerCreditPurchase(scope(owner),{
    token:owner.token,ownerSubject:subject(owner),operationId,payload:input
  });

test('MVP operational credit purchase atomically posts Supplier payable, lot, stock and original-shaped history',async()=>{
  const {ownerA,ownerB,SHOP_A_DB:a,SHOP_B_DB:b,close}=await startCleanShopHarness();
  try{
    await install(a);await install(b);
    await ready(ownerA);await ready(ownerB);
    const before=await readOwnerPurchaseBootstrap(a);
    assert.equal(before.products[0].stock,0);
    assert.deepEqual(before.suppliers.map(s=>s.id),['SUP-000001']);
    const cashOpenOp=crypto.randomUUID();
    const session=await open(ownerA,cashOpenOp);
    assert.deepEqual(session,{status:'started',sessionId:'CS-000001'});
    assert.deepEqual(await open(ownerA,cashOpenOp),{status:'replayed',sessionId:'CS-000001'});
    const op=crypto.randomUUID(),input=purchase();
    const r=await post(ownerA,input,op);
    assert.deepEqual(r,{status:'created',purchaseId:'PUR-000001',grandTotal:600,dueAmount:600});
    assert.deepEqual(await post(ownerA,input,op),{
      status:'replayed',purchaseId:'PUR-000001',grandTotal:600,dueAmount:600
    });
    assert.deepEqual(await post(ownerA,{...input,notes:'Changed'},op),{status:'conflict'});
    const history=await readOwnerPurchaseHistory(a);
    assert.equal(history.length,1);
    assert.equal(history[0].purchaseId,'PUR-000001');
    assert.equal(history[0].paymentStatus,'Due');
    assert.equal(history[0].dueAmount,600);
    assert.equal((await readOwnerPurchaseBootstrap(a)).products[0].stock,10);
    assert.equal((await a.prepare('SELECT current_due_paisa AS due FROM owner_supplier_master').first()).due,60000);
    assert.equal((await a.prepare('SELECT COUNT(*) AS n FROM owner_mvp_purchase_lines').first()).n,1);
    assert.equal((await a.prepare('SELECT qty_micro FROM owner_mvp_stock_lots').first()).qty_micro,10000000);
    assert.equal((await a.prepare('SELECT quantity_micro FROM owner_mvp_product_stock').first()).quantity_micro,10000000);
    assert.equal((await a.prepare('SELECT debit_paisa FROM owner_mvp_supplier_ledger').first()).debit_paisa,60000);
    assert.equal((await b.prepare('SELECT COUNT(*) AS n FROM owner_mvp_purchase_receipts').first()).n,0);
  }finally{await close();}
});

test('MVP first Purchase fails closed: no cash session, wrong Shop, replay conflict, expired grant and unsupported money',async()=>{
  const {ownerA,ownerB,SHOP_A_DB:a,SHOP_B_DB:b,close}=await startCleanShopHarness();
  try{
    await install(a);await install(b);
    await ready(ownerA);await ready(ownerB);
    assert.deepEqual(await post(ownerA,purchase()),{status:'session-required'});
    assert.deepEqual(await post(ownerA,purchase({paidAmount:'5.00'})),{status:'unsupported'});
    assert.deepEqual(await post(ownerA,purchase({discount:'1'})),{status:'unsupported'});
    assert.deepEqual(await post(ownerA,purchase({date:'2020-01-01',backdatedReason:'History'})),{status:'unsupported'});
    assert.deepEqual(await post(ownerA,purchase({items:[{...purchase().items[0],unitBreakdown:[{unit:'Box',qty:'1'}]}]})),{status:'unsupported'});
    await open(ownerA);
    assert.deepEqual(await post(ownerA,purchase({supplierId:'SUP-000999'})),{status:'denied'});
    const before=(await a.prepare('SELECT COUNT(*) AS n FROM owner_mvp_purchase_receipts').first()).n;
    assert.deepEqual(await post(ownerA,purchase({items:[{...purchase().items[0],productId:'PRD-999999'}]})),{status:'denied'});
    const otherScope=scope(ownerB);
    assert.deepEqual(await postOwnerCreditPurchase(otherScope,{
      token:ownerA.token,ownerSubject:subject(ownerA),operationId:crypto.randomUUID(),payload:purchase()
    }),{status:'denied'});
    assert.equal((await a.prepare('SELECT COUNT(*) AS n FROM owner_mvp_purchase_receipts').first()).n,before);
    await a.prepare('UPDATE shop_owner_write_grant SET expires_at_ms=? WHERE singleton=1')
      .bind(Date.now()-1000).run();
    assert.deepEqual(await post(ownerA,purchase()),{status:'denied'});
    assert.equal((await a.prepare('SELECT COUNT(*) AS n FROM owner_mvp_supplier_ledger').first()).n,0);
    assert.equal((await a.prepare('SELECT COUNT(*) AS n FROM owner_mvp_product_stock').first()).n,0);
  }finally{await close();}
});

test('MVP close day denies subsequent credit Purchase even if previous session ID was selected',async()=>{
  const {ownerA,SHOP_A_DB:a,close}=await startCleanShopHarness();
  try{
    await install(a);await ready(ownerA);await open(ownerA);
    assert.deepEqual(await closeOwnerCashSession(scope(ownerA),{
      token:ownerA.token,ownerSubject:subject(ownerA),operationId:crypto.randomUUID(),
      countedCash:'0',notes:'Close Day'
    }),{status:'closed',sessionId:'CS-000001',variance:0});
    assert.deepEqual(await post(ownerA,purchase()),{status:'session-required'});
    assert.equal((await a.prepare('SELECT COUNT(*) AS n FROM owner_mvp_purchase_receipts').first()).n,0);
  }finally{await close();}
});
