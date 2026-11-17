import test from 'node:test';
import assert from 'node:assert/strict';
import {planMultiUnitPosLine} from '../src/modules/m06-multi-unit-pos-line.js';

// TDD RED: the M07-only read-only historical return planner is deliberately
// missing in this commit. The exact M06 sale-line snapshot is already merged.
import {planHistoricalMixedUnitFullReturn} from '../src/modules/m07-historical-mixed-unit-full-return.js';

const product=()=>({
 'Product ID':'P-HIST','Product Name':'Fitting','Product Type':'Standard',
 Unit:'Pcs','Selling Price':10,'Purchase Price':6,'Current Stock':145,
 Status:'Active','Is Deleted':'FALSE'
});
const conversions=()=>[
 {'Conversion ID':'C-BAG','Product ID':'P-HIST','Unit Name':'Bag',
  'Conversion Factor':100,'Selling Price':900,'Sort Order':1,Status:'Active'},
 {'Conversion ID':'C-BOX','Product ID':'P-HIST','Unit Name':'Box',
  'Conversion Factor':20,'Selling Price':190,'Sort Order':2,Status:'Active'}
];
const lots=()=>[
 {'Lot ID':'LOT-OLD','Product ID':'P-HIST','Purchase Date':'2026-11-10',
  'Remaining Quantity':100,'Sell Price':10,'Purchase Price':6,Status:'Active'},
 {'Lot ID':'LOT-NEW','Product ID':'P-HIST','Purchase Date':'2026-11-12',
  'Remaining Quantity':45,'Sell Price':12,'Purchase Price':7,Status:'Active'}
];
const saleIntent=()=>({
 productId:'P-HIST',claimedBaseQty:145,shortageMode:'Own',
 unitBreakdown:[
  {conversionId:'C-BAG',qty:1},
  {conversionId:'C-BOX',qty:2},
  {conversionId:'BASE',qty:5}
 ]
});
const posted=()=>{
 const p=planMultiUnitPosLine(saleIntent(),{
  products:[product()],conversionRows:conversions(),stockLots:lots()
 });
 assert.equal(p.baseQty,145);
 assert.equal(p.lineTotal,1340);
 return {
  tenantId:'SHOP-A',invoiceId:'INV-HIST-A',
  sourceLineHash:'a'.repeat(64),lineTotalPaisa:134000,
  activeReturnedBaseQty:0,...p
 };
};
const request=(patch={})=>({
 tenantId:'SHOP-A',invoiceId:'INV-HIST-A',returnId:'RET-HIST-A',
 productId:'P-HIST',unitBreakdown:[
  {conversionId:'C-BAG',qty:1},{conversionId:'C-BOX',qty:2},
  {conversionId:'BASE',qty:5}
 ],...patch
});
const plan=(s=posted(),i=request())=>planHistoricalMixedUnitFullReturn(s,i);

test('one 1 Bag + 2 Box + 5 Pcs full return preserves exact original 145 Pcs and 134000 paisa',()=>{
 const s=posted(),i=request(),before=structuredClone({s,i});
 const r=plan(s,i);
 assert.deepEqual(r,{
  status:'PLAN_ONLY',data:{
   tenantId:'SHOP-A',invoiceId:'INV-HIST-A',returnId:'RET-HIST-A',
   productId:'P-HIST',stockUnit:'Pcs',
   baseQty:145,refundCeilingPaisa:134000,
   historicalUnits:[
    {conversionId:'C-BAG',unitName:'Bag',factor:100,qty:1},
    {conversionId:'C-BOX',unitName:'Box',factor:20,qty:2},
    {conversionId:'BASE',unitName:'Pcs',factor:1,qty:5}
   ],
   historicalUnitPrices:[
    {conversionId:'C-BAG',unitName:'Bag',factor:100,qty:1,unitPrice:900},
    {conversionId:'C-BOX',unitName:'Box',factor:20,qty:2,unitPrice:190},
    {conversionId:'BASE',unitName:'Pcs',factor:1,qty:5,unitPrice:12}
   ],
   restoreOriginalLots:[
    {lotId:'LOT-OLD',baseQty:100},
    {lotId:'LOT-NEW',baseQty:45}
   ],
   readOnly:true,commitAuthorized:false
  }
 });
 assert.deepEqual({s,i},before,'Read-only plan never mutates saved sale or browser intent');
 assert.notStrictEqual(r.data.historicalUnits,s.unitBreakdownSnapshot);
 assert.notStrictEqual(r.data.restoreOriginalLots,s.fifoDraws);
 assert.equal(Object.isFrozen(r.data.historicalUnits[0]),true);
});

test('a later conversion factor and price update does not reinterpret the saved sale',()=>{
 const source=posted(),input=request(),expected=plan(source,input);
 const changedProducts=[product()],changedConversions=conversions();
 changedProducts[0]['Selling Price']=5000;
 changedProducts[0]['Current Stock']=999;
 changedConversions[0]['Conversion Factor']=200;
 changedConversions[0]['Selling Price']=1;
 changedConversions[1].Status='Inactive';
 // M07 accepts only original persisted evidence, never the live catalog.
 assert.deepEqual(plan(source,input),expected);
});

test('partial returned unit requests decline rather than guessing component-to-lot attribution',()=>{
 for(const breakdown of [
  [{conversionId:'C-BAG',qty:1}],
  [{conversionId:'C-BOX',qty:2},{conversionId:'BASE',qty:5}],
  [{conversionId:'C-BAG',qty:1},{conversionId:'C-BOX',qty:1},{conversionId:'BASE',qty:5}],
  [{conversionId:'C-BAG',qty:1},{conversionId:'C-BOX',qty:2},{conversionId:'BASE',qty:4}]
 ])assert.deepEqual(plan(posted(),request({unitBreakdown:breakdown})),
  {status:'DECLINED',reason:'PARTIAL_REQUIRES_ORIGINAL_COMPONENT_LOT_PROVENANCE'});
});

test('any prior active returned base quantity blocks an unproven second full reversal',()=>{
 const s=posted();s.activeReturnedBaseQty=5;
 assert.deepEqual(plan(s,request()),
  {status:'DECLINED',reason:'ACTIVE_RETURN_ALREADY_EXISTS'});
});

test('Vendor/Negative or any unproven shortage cannot become invented restored FIFO stock',()=>{
 for(const [mode,shortfall] of [['Vendor',0],['Negative',0],['Own',1],['Vendor',5]]){
  const s=posted();s.shortageMode=mode;s.shortfallBaseQty=shortfall;
  assert.deepEqual(plan(s,request()),
   {status:'DECLINED',reason:'UNSUPPORTED_ORIGINAL_SHORTAGE_PROVENANCE'});
 }
});

test('forged browser factor, unit price, lot, SQL and authorization fields are rejected',()=>{
 const input=request();
 for(const payload of [
  {...input,sql:'UPDATE m06_owned_stock'},
  {...input,actorId:'SUPERADMIN'},
  {...input,pricePaisa:0},
  {...input,stockLot:'LOT-FAKE'},
  {...input,unitBreakdown:[{conversionId:'C-BAG',qty:1,factor:2},
   ...input.unitBreakdown.slice(1)]},
  {...input,unitBreakdown:[{conversionId:'C-BAG',qty:1,unitPrice:0},
   ...input.unitBreakdown.slice(1)]}
 ])assert.throws(()=>plan(posted(),payload),/invalid|shape|untrusted/i);
});

test('mixed tenant, wrong invoice/product/return ID and malformed ID cannot project other records',()=>{
 for(const patch of [
  {tenantId:'SHOP-B'},{invoiceId:'INV-OTHER'},{productId:'P-OTHER'},
  {returnId:''},{returnId:'A; DROP TABLE x'}
 ]){
  assert.throws(()=>plan(posted(),request(patch)),/identity|invalid|mismatch/i);
 }
});

test('missing/duplicate conversion IDs or unrecognized original return component cannot pass',()=>{
 const s=posted();
 const bad=structuredClone(s);
 bad.unitBreakdownSnapshot.push({...bad.unitBreakdownSnapshot[0]});
 assert.throws(()=>plan(bad),/NEEDS_REVIEW|duplicate|source/i);
 const input=request();input.unitBreakdown[2].conversionId='C-UNKNOWN';
 assert.deepEqual(plan(s,input),
  {status:'DECLINED',reason:'PARTIAL_REQUIRES_ORIGINAL_COMPONENT_LOT_PROVENANCE'});
 const duplicate=request();duplicate.unitBreakdown[1].conversionId='C-BAG';
 assert.throws(()=>plan(s,duplicate),/duplicate|invalid/i);
});

test('missing pricing evidence or mismatched saved pricing factor/qty fails closed',()=>{
 for(const change of [
  s=>{s.unitPricingSnapshot=[];},
  s=>{s.unitPricingSnapshot[0].factor=200;},
  s=>{s.unitPricingSnapshot[1].qty=3;},
  s=>{s.unitPricingSnapshot[2].conversionId='C-BOX';},
  s=>{s.unitPricingSnapshot[1].unitPrice=-1;}
 ]){
  const s=posted();change(s);
  assert.throws(()=>plan(s),/NEEDS_REVIEW|pricing|snapshot|source/i);
 }
});

test('lost, repeated or mismatched original FIFO lot evidence fails closed',()=>{
 for(const change of [
  s=>{s.fifoDraws=[];},
  s=>{s.fifoDraws[0].baseQty=99;},
  s=>{s.fifoDraws[1].lotId='LOT-OLD';},
  s=>{s.fifoDraws[0].lotId='';}
 ]){
  const s=posted();change(s);
  assert.throws(()=>plan(s),/NEEDS_REVIEW|lot|source/i);
 }
});

test('forged original baseQty, saved line cents, hash and unsafe amounts fail closed',()=>{
 for(const change of [
  s=>{s.baseQty=144;},
  s=>{s.lineTotalPaisa=133999;},
  s=>{s.lineTotalPaisa=Number.MAX_SAFE_INTEGER+1;},
  s=>{s.lineTotal=Infinity;},
  s=>{s.lineTotal=-5;},
  s=>{s.sourceLineHash='forged';}
 ]){
  const s=posted();change(s);
  assert.throws(()=>plan(s),/NEEDS_REVIEW|invalid|source|money/i);
 }
});

test('noninteger/fractional factors and return quantities fail closed in first piece-unit proof',()=>{
 for(const change of [
  s=>{s.unitBreakdownSnapshot[0].factor=99.5;},
  s=>{s.unitBreakdownSnapshot[1].qty=1.5;},
  s=>{s.unitBreakdownSnapshot[0].factor=0;},
  s=>{s.unitBreakdownSnapshot[0].factor=Number.MAX_SAFE_INTEGER;}
 ]){
  const s=posted();change(s);
  assert.throws(()=>plan(s),/NEEDS_REVIEW|factor|quantity|source/i);
 }
 const fractional=request();
 fractional.unitBreakdown[0].qty=0.5;
 assert.throws(()=>plan(posted(),fractional),/invalid|quantity/i);
});

test('legacy sale lacking immutable unit/price/lot snapshots cannot pretend multi-unit parity',()=>{
 const s=posted();
 delete s.unitBreakdownSnapshot;
 assert.throws(()=>plan(s),/NEEDS_REVIEW|source|snapshot/i);
});

test('getters, null input, forged nested objects and input mutation are rejected',()=>{
 const s=posted(),i=request();
 assert.throws(()=>plan(null,i),/invalid|source/i);
 assert.throws(()=>plan(s,null),/invalid|request/i);
 const hostile=posted();
 Object.defineProperty(hostile,'invoiceId',{enumerable:true,get(){throw Error('getter');}});
 assert.throws(()=>plan(hostile,i),/invalid|untrusted|source/i);
 const poisoned=request();
 Object.defineProperty(poisoned.unitBreakdown[0],'qty',{
  enumerable:true,get(){throw Error('getter');}
 });
 assert.throws(()=>plan(s,poisoned),/invalid|untrusted|shape/i);
});

test('restoration preview has no private financial accounts or real inventory authority',()=>{
 const s=posted();
 s.supplierAccount='SENSITIVE-SUPPLIER';
 s.cashBook=[{amount:999}];
 const r=plan(s,request());
 assert.equal(JSON.stringify(r).includes('SENSITIVE-SUPPLIER'),false);
 assert.equal(JSON.stringify(r).includes('unitCost'),false);
 assert.equal(JSON.stringify(r).includes('Purchase Price'),false);
 assert.equal(JSON.stringify(r).includes('cashBook'),false);
 assert.equal(JSON.stringify(r).includes('commitAuthorized":true'),false);
});
