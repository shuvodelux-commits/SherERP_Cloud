import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareMultiUnitPurchasePreflight} from '../src/modules/m05-multi-unit-purchase-preflight.js';
import {auditHistoricalUnitLotHandoff} from '../src/modules/m05-historical-unit-lot-handoff.js';

const tenantId='SHOP-A', purchaseId='PUR-111', productId='P-CABLE', supplierId='SUP-A';
const products=[{'Product ID':productId,'Product Name':'Cable','Product Type':'Standard',
  Unit:'Pcs','Purchase Price':6,'Selling Price':10,'Current Stock':0}];
const suppliers=[{'Supplier ID':supplierId,'Supplier Name':'Supplier A',Status:'Active'}];
const conversionRows=[
  {'Conversion ID':'C-BAG','Product ID':productId,'Unit Name':'Bag',
    'Conversion Factor':100,'Purchase Price':500,'Sort Order':1,Status:'Active'},
  {'Conversion ID':'C-BOX','Product ID':productId,'Unit Name':'Box',
    'Conversion Factor':20,'Purchase Price':100,'Sort Order':2,Status:'Active'}
];
const preflight=()=>prepareMultiUnitPurchasePreflight({
  supplierId,items:[{
    productId,name:'Cable',qty:145,unitPrice:1,sellingPrice:10,
    unitBreakdown:[{conversionId:'C-BAG',qty:1},{conversionId:'C-BOX',qty:2},
      {conversionId:'BASE',qty:5}]
  }]
},{products,suppliers,conversionRows});

function snapshot(){
  const quote=preflight(),line=quote.lines[0];
  return {
    tenantId,purchaseId,
    purchaseHeader:{'Tenant ID':tenantId,'Purchase ID':purchaseId,
      'Supplier ID':supplierId,Date:'2026-11-19','Is Deleted':''},
    preflight:quote,
    purchaseItems:[{'Tenant ID':tenantId,'Purchase ID':purchaseId,
      'Product ID':productId,Quantity:145,'Unit Price':730/145}],
    stockLots:[{'Tenant ID':tenantId,'Lot ID':'LOT-ABCD','Purchase ID':purchaseId,
      'Product ID':productId,'Supplier ID':supplierId,'Purchase Date':'2026-11-19',
      'Original Quantity':145,'Remaining Quantity':142,
      'Purchase Price':730/145,Status:'Active'}],
    unitReceipts:[{tenantId,purchaseId,productId,unit:structuredClone(line.unit)}]
  };
}
const issues=record=>record.issues.map(x=>x.code);
const check=s=>auditHistoricalUnitLotHandoff(s);

test('independent historical unit receipt still conserves 145 Pcs at original 730 taka with no source mutation',()=>{
  const s=snapshot(),before=structuredClone(s);
  const r=check(s);
  assert.equal(r.ready,true,JSON.stringify(r.issues));
  assert.equal(r.unitAudit.ready,true);
  assert.equal(r.lotAudit.ready,true);
  assert.equal(r.checkedProducts,1);
  assert.equal(r.postingAllowed,false);
  assert.equal(s.preflight.lines[0].unit.lineTotal,730);
  assert.deepEqual(s,before);
});

test('direct receipt alias of mutable preflight unit cannot be mistaken for independent evidence',()=>{
  const s=snapshot();
  s.unitReceipts[0].unit=s.preflight.lines[0].unit;
  const r=check(s);
  assert.equal(r.ready,false);
  assert.ok(issues(r).includes('UNIT_RECEIPT_ALIASED'),JSON.stringify(r.issues));
  assert.equal(r.postingAllowed,false);
});

test('shallow unit record copy still shares nested quantity and price arrays and must be quarantined',()=>{
  const s=snapshot();
  s.unitReceipts[0].unit={...s.preflight.lines[0].unit};
  const r=check(s);
  assert.equal(r.ready,false);
  assert.ok(issues(r).includes('UNIT_RECEIPT_ALIASED'),JSON.stringify(r.issues));
});

test('one reused nested historical component reference cannot bypass otherwise deep receipt cloning',()=>{
  const s=snapshot(),unit=s.preflight.lines[0].unit;
  s.unitReceipts[0].unit.unitSnapshot[0]=unit.unitSnapshot[0];
  const r=check(s);
  assert.equal(r.ready,false);
  assert.ok(issues(r).includes('UNIT_RECEIPT_ALIASED'),JSON.stringify(r.issues));
});

test('100 to 120 conversion rewrite must fail even when purchase item and lot are adjusted and the same receipt aliases preflight',()=>{
  const s=snapshot(),line=s.preflight.lines[0];
  s.unitReceipts[0].unit=line.unit;
  line.unit.unitSnapshot[0].factor=120;
  line.unit.pricingSnapshot[0].factor=120;
  line.qty=165;
  line.price=730/165;
  s.purchaseItems[0].Quantity=165;
  s.purchaseItems[0]['Unit Price']=line.price;
  s.stockLots[0]['Original Quantity']=165;
  s.stockLots[0]['Purchase Price']=line.price;

  const r=check(s);
  assert.equal(r.unitAudit.ready,true,JSON.stringify(r.unitAudit.issues));
  assert.equal(r.lotAudit.ready,true,JSON.stringify(r.lotAudit.issues));
  assert.equal(r.ready,false);
  assert.ok(issues(r).includes('UNIT_RECEIPT_ALIASED'),JSON.stringify(r.issues));
  assert.equal(r.postingAllowed,false);
});

test('trusted record rejects executable toString field before coercing deleted purchase status',()=>{
  let executions=0;
  const s=snapshot();
  s.purchaseHeader['Is Deleted']={toString(){executions++;return ''}};
  assert.throws(()=>check(s),/trusted|callable|function|record/i);
  assert.equal(executions,0,'audit must not execute functions embedded in evidence');
});

test('symbol-valued historical record fields are not accepted as source evidence',()=>{
  const s=snapshot();
  s.purchaseHeader['Is Deleted']=Symbol('not-source');
  assert.throws(()=>check(s),/trusted|symbol|invalid/i);
});
