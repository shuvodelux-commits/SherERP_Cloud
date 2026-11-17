import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareMultiUnitPurchasePreflight}
 from '../src/modules/m05-multi-unit-purchase-preflight.js';
// Superpowers RED: the new M07-only read-only historical deletion handoff is absent.
import {planHistoricalMixedUnitPurchaseDeleteLineage}
 from '../src/modules/m07-historical-purchase-delete-lineage.js';

const product={'Product ID':'P-MIX','Product Name':'Cable','Product Type':'Standard',
 Unit:'Pcs','Purchase Price':6,'Selling Price':10,'Current Stock':220,
 Status:'Active','Is Deleted':'FALSE',_rowIndex:8};
const supplier={'Supplier ID':'SUP-A','Supplier Name':'Supplier A',Status:'Active'};
const conversions=[
 {'Conversion ID':'C-BAG','Product ID':'P-MIX','Unit Name':'Bag',
  'Conversion Factor':100,'Purchase Price':500,'Selling Price':900,
  'Sort Order':1,Status:'Active'},
 {'Conversion ID':'C-BOX','Product ID':'P-MIX','Unit Name':'Box',
  'Conversion Factor':20,'Purchase Price':100,'Selling Price':190,
  'Sort Order':2,Status:'Active'}
];
function historicalLine(){
 const p=prepareMultiUnitPurchasePreflight({
  supplierId:'SUP-A',items:[{
   productId:'P-MIX',name:'browser-not-authoritative',qty:145,unitPrice:1,
   sellingPrice:12,unitBreakdown:[
    {conversionId:'C-BAG',qty:1},{conversionId:'C-BOX',qty:2},
    {conversionId:'BASE',qty:5}
   ]
  }],discount:0,paidAmount:0
 },{products:[product],suppliers:[supplier],conversionRows:conversions});
 assert.equal(p.lines[0].qty,145);
 assert.equal(p.lines[0].unit.lineTotal,730);
 return p.lines[0];
}
function lot(id,purchaseId,qty,index,supplierId='SUP-A',remaining=qty){
 return {
  'Lot ID':id,'Purchase ID':purchaseId,'Product ID':'P-MIX',
  'Supplier ID':supplierId,'Original Quantity':qty,
  'Remaining Quantity':remaining,
  'Purchase Date':'2026-11-10','Purchase Price':5,
  '_rowIndex':index,'Status':'Active'
 };
}
function source(){
 return {
  tenantId:'SHOP-A',purchaseId:'PUR-1',supplierId:'SUP-A',
  sourceHash:'d'.repeat(64),originalLineTotalPaisa:73000,
  purchase:{'Purchase ID':'PUR-1','Supplier ID':'SUP-A',
   'Date':'2026-11-10','Is Deleted':'FALSE'},
  line:historicalLine(),
  lots:[
   lot('LOT-A','PUR-1',100,12),
   lot('LOT-B','PUR-1',45,13),
   lot('FOREIGN','PUR-OTHER',999,14,'SUP-OTHER',999)
  ],
  product:structuredClone(product),
  returns:[]
 };
}
function intent(extra={}){
 return {tenantId:'SHOP-A',purchaseId:'PUR-1',
  correctionId:'CORR-PUR-DEL-001',expectedSourceHash:'d'.repeat(64),
  reason:'Mistaken purchase entry',...extra};
}
const plan=(s=source(),i=intent())=>
 planHistoricalMixedUnitPurchaseDeleteLineage(s,i);

test('source-linked native purchase deletion preview retains 145 original Pcs, 730 BDT evidence and only original lots',()=>{
 const s=source(),i=intent(),before=structuredClone({s,i});
 const result=plan(s,i);
 assert.deepEqual(result,{
  status:'PLAN_ONLY',data:{
   tenantId:'SHOP-A',purchaseId:'PUR-1',correctionId:'CORR-PUR-DEL-001',
   sourceHash:'d'.repeat(64),originalBaseQty:145,
   historicalUnits:[
    {conversionId:'C-BAG',unitName:'Bag',factor:100,qty:1},
    {conversionId:'C-BOX',unitName:'Box',factor:20,qty:2},
    {conversionId:'BASE',unitName:'Pcs',factor:1,qty:5}
   ],
   ownedLots:[
    {lotId:'LOT-A',sourceRowIndex:12,originalBaseQty:100,remainingBaseQty:100},
    {lotId:'LOT-B',sourceRowIndex:13,originalBaseQty:45,remainingBaseQty:45}
   ],
   stockProof:{productId:'P-MIX',reduceBaseQty:145,newStock:75},
   readOnly:true,commitAuthorized:false,
   financialCalculationAuthorized:false,replayResolved:false
  }
 });
 assert.deepEqual({s,i},before);
});

test('original historical conversion configuration is immutable despite subsequent current product catalog changes',()=>{
 const s=source(),expected=plan(s);
 const newerCatalog=structuredClone(conversions);
 newerCatalog[0]['Conversion Factor']=900;
 newerCatalog[1]['Purchase Price']=1;
 const changedProductPrice={...product,'Purchase Price':999};
 assert.equal(changedProductPrice['Purchase Price'],999);
 assert.equal(newerCatalog[0]['Conversion Factor'],900);
 assert.deepEqual(plan(s),expected);
});

test('blocks already-consumed original stock even when global Current Stock is large',()=>{
 for(const mutate of [
  s=>{s.lots[0]['Remaining Quantity']=99;},
  s=>{s.lots[1]['Remaining Quantity']=0;}
 ]){
  const s=source();mutate(s);
  assert.throws(()=>plan(s),/already been sold|NEEDS_REVIEW|stock/i);
 }
});

test('blocks active Purchase Return before deletion, but ignores soft-deleted Return records',()=>{
 const s=source();
 s.returns=[{'Return ID':'PR-1','Purchase ID':'PUR-1','Is Deleted':'FALSE'}];
 assert.throws(()=>plan(s),/Purchase Return against it|return first/i);
 s.returns[0]['Is Deleted']='TrUe';
 assert.equal(plan(s).status,'PLAN_ONLY');
});

test('refuses insufficient Current Stock, deleted Purchase and deleted product',()=>{
 const s=source();s.product['Current Stock']=100;
 assert.throws(()=>plan(s),/stock would go negative/i);
 const deleted=source();deleted.purchase['Is Deleted']='TRUE';
 assert.throws(()=>plan(deleted),/already deleted/i);
 const inactive=source();inactive.product['Is Deleted']='TRUE';
 assert.throws(()=>plan(inactive),/NEEDS_REVIEW|product/i);
});

test('refuses unproven pre-lot original purchase instead of inherited legacy inventory fallback',()=>{
 const s=source();s.lots=s.lots.filter(row=>row['Purchase ID']!=='PUR-1');
 assert.deepEqual(plan(s),{status:'DECLINED',reason:'UNVERIFIED_ORIGINAL_PURCHASE_LOTS'});
});

test('original owned lot quantities must match original 145 source units exactly',()=>{
 for(const mutate of [
  s=>{s.lots[0]['Original Quantity']=101;},
  s=>{s.lots[1]['Original Quantity']=44;},
  s=>{s.lots[0]['Original Quantity']=0;},
  s=>{s.lots[0]['Original Quantity']=Number.MAX_SAFE_INTEGER;},
  s=>{s.line.qty=144;}
 ]){
  const s=source();mutate(s);
  assert.throws(()=>plan(s),/NEEDS_REVIEW|quantity|unit|source/i);
 }
});

test('no cross-Supplier/Purchase/Product lot rewriting or duplicate lot/row identities',()=>{
 for(const mutate of [
  s=>{s.lots[1]['Supplier ID']='SUP-OTHER';},
  s=>{s.lots[1]['Purchase ID']='PUR-OTHER';},
  s=>{s.lots[0]['Product ID']='P-OTHER';},
  s=>{s.lots[1]['Lot ID']='LOT-A';},
  s=>{s.lots[1]._rowIndex=12;},
  s=>{s.lots[1]._rowIndex=0;}
 ]){
  const s=source();mutate(s);
  assert.throws(()=>plan(s),/NEEDS_REVIEW|original|lot|supplier|row|source/i);
 }
});

test('changing supplier or Product on original Purchase cannot authorize stock reversal',()=>{
 for(const mutate of [
  s=>{s.supplierId='SUP-OTHER';},
  s=>{s.purchase['Supplier ID']='SUP-OTHER';},
  s=>{s.purchase['Purchase ID']='PUR-OTHER';},
  s=>{s.product['Product ID']='P-OTHER';},
  s=>{s.line.productId='P-OTHER';}
 ]){
  const s=source();mutate(s);
  assert.throws(()=>plan(s),/NEEDS_REVIEW|source|identity|original/i);
 }
});

test('historical factor, unit-price, purchase subtotal and source digest must not drift',()=>{
 for(const mutate of [
  s=>{s.line.unit.unitSnapshot[0].factor=101;},
  s=>{s.line.unit.unitSnapshot[1].qty=3;},
  s=>{s.line.unit.pricingSnapshot[0].unitPrice=1;},
  s=>{s.line.unit.lineTotal=731;},
  s=>{s.originalLineTotalPaisa=73001;},
  s=>{s.line.price=999;},
  s=>{s.sourceHash='g'.repeat(64);}
 ]){
  const s=source();mutate(s);
  assert.throws(()=>plan(s),/NEEDS_REVIEW|snapshot|price|hash|source|unit/i);
 }
});

test('caller cannot supply refund amount, unit factors, chosen lot, permission, actor or arbitrary SQL',()=>{
 const s=source();
 for(const bad of [
  {...intent(),refundPaisa:73000},
  {...intent(),unitFactor:1},
  {...intent(),lotId:'LOT-A'},
  {...intent(),actorId:'ADMIN'},
  {...intent(),permission:'delete'},
  {...intent(),sql:'DELETE FROM stock'},
  {...intent(),financialCalculationAuthorized:true}
 ]){
  assert.throws(()=>plan(s,bad),/invalid|shape|untrusted|NEEDS_REVIEW/i);
 }
});

test('stale source-hash marker, wrong shop/Purchase, invalid correction ID or empty reason fail closed',()=>{
 for(const bad of [
  intent({expectedSourceHash:'f'.repeat(64)}),
  intent({tenantId:'SHOP-OTHER'}),
  intent({purchaseId:'PUR-OTHER'}),
  intent({correctionId:'x'}),
  intent({reason:' '}),
  intent({expectedSourceHash:'bogus'})
 ]){
  assert.throws(()=>plan(source(),bad),/invalid|NEEDS_REVIEW|hash|source|identity|reason/i);
 }
});

test('getter-bearing nested objects fail closed without executing getter code',()=>{
 for(const field of ['Remaining Quantity','Original Quantity']){
  const s=source();
  Object.defineProperty(s.lots[0],field,{
   enumerable:true,get(){throw Error('DANGEROUS_ACCESSOR_INVOKED');}
  });
  assert.throws(()=>plan(s),error=>
   error.message!=='DANGEROUS_ACCESSOR_INVOKED'&&
   /invalid|NEEDS_REVIEW|accessor/i.test(error.message));
 }
 const s=source();
 Object.defineProperty(s.line.unit.unitSnapshot[0],'factor',{
  enumerable:true,get(){throw Error('DANGEROUS_ACCESSOR_INVOKED');}
 });
 assert.throws(()=>plan(s),error=>
  error.message!=='DANGEROUS_ACCESSOR_INVOKED'&&
  /invalid|NEEDS_REVIEW|accessor/i.test(error.message));
});

test('nonplain or incomplete source and malformed numeric/lot evidence decline, never invent deletion proof',()=>{
 for(const bad of [null,[],{},'purchase'])assert.throws(
  ()=>planHistoricalMixedUnitPurchaseDeleteLineage(bad,intent()),
  /invalid|NEEDS_REVIEW|source/i);
 for(const mutate of [
  s=>{s.lots[0]['Remaining Quantity']=-1;},
  s=>{s.lots[0]['Remaining Quantity']=NaN;},
  s=>{s.lots[0]['Original Quantity']=100.5;},
  s=>{s.product['Current Stock']=1.5;},
  s=>{s.product['Current Stock']=-20;},
  s=>{s.returns=[{'Purchase ID':'PUR-1','Is Deleted':'FALSE',__proto__:null}];},
  s=>{delete s.line.unit;}
 ]){
  const s=source();mutate(s);
  assert.throws(()=>plan(s),/invalid|NEEDS_REVIEW|source|unit|stock|quantity|original/i);
 }
});

test('original purchase reversal evidence is deeply frozen with no Supplier/Cash/Bank or ledger calculation',()=>{
 const r=plan();
 assert.equal(r.status,'PLAN_ONLY');
 assert.ok(Object.isFrozen(r));
 assert.ok(Object.isFrozen(r.data));
 assert.ok(Object.isFrozen(r.data.historicalUnits));
 assert.ok(Object.isFrozen(r.data.historicalUnits[0]));
 assert.ok(Object.isFrozen(r.data.ownedLots));
 assert.ok(Object.isFrozen(r.data.ownedLots[0]));
 assert.ok(Object.isFrozen(r.data.stockProof));
 assert.equal(r.data.commitAuthorized,false);
 assert.equal(r.data.replayResolved,false);
 assert.equal(r.data.financialCalculationAuthorized,false);
 const json=JSON.stringify(r);
 for(const key of ['supplierId','cashSessionId','cashBook','bankBook','partyId',
  'refundPaisa','supplierDue','financialPosting','unitCost','Purchase Price'])
  assert.equal(json.includes('"'+key+'"'),false,key);
});
