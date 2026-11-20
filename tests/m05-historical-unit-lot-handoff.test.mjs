import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareMultiUnitPurchasePreflight} from '../src/modules/m05-multi-unit-purchase-preflight.js';
import {auditHistoricalUnitLotHandoff} from '../src/modules/m05-historical-unit-lot-handoff.js';

const TENANT='SHOP-001', PURCHASE='PUR-000201', SUPPLIER='SUP-000301';
const CABLE='PRD-CABLE', PIPE='PRD-PIPE';
const products=[
  {'Product ID':CABLE,'Product Name':'Cable','Product Type':'Standard',
    Unit:'Pcs','Purchase Price':6,'Selling Price':10,'Current Stock':0},
  {'Product ID':PIPE,'Product Name':'Pipe','Product Type':'Standard',
    Unit:'Feet','Purchase Price':9,'Selling Price':15,'Current Stock':0}
];
const suppliers=[{'Supplier ID':SUPPLIER,'Supplier Name':'Original Supplier',Status:'Active'}];
const conversionRows=[
  {'Conversion ID':'C-BAG','Product ID':CABLE,'Unit Name':'Bag',
    'Conversion Factor':100,'Purchase Price':500,'Sort Order':1,Status:'Active'},
  {'Conversion ID':'C-BOX','Product ID':CABLE,'Unit Name':'Box',
    'Conversion Factor':20,'Purchase Price':100,'Sort Order':2,Status:'Active'}
];
const payload=()=>({supplierId:SUPPLIER,items:[
  {productId:CABLE,name:'Caller label',qty:145,unitPrice:1,sellingPrice:10,
    unitBreakdown:[
      {conversionId:'C-BAG',qty:1},{conversionId:'C-BOX',qty:2},
      {conversionId:'BASE',qty:5}
    ]},
  {productId:PIPE,name:'Pipe',qty:2,unitPrice:9,sellingPrice:15}
]});
function fixture(){
  const preflight=prepareMultiUnitPurchasePreflight(payload(),{
    products,suppliers,conversionRows
  });
  const [unitLine,legacyLine]=preflight.lines;
  return {tenantId:TENANT,purchaseId:PURCHASE,
    purchaseHeader:{'Tenant ID':TENANT,'Purchase ID':PURCHASE,
      'Supplier ID':SUPPLIER,Date:'2026-11-11','Is Deleted':''},
    preflight,
    purchaseItems:[
      {'Tenant ID':TENANT,'Purchase ID':PURCHASE,'Product ID':CABLE,
        Quantity:unitLine.qty,'Unit Price':unitLine.price},
      {'Tenant ID':TENANT,'Purchase ID':PURCHASE,'Product ID':PIPE,
        Quantity:legacyLine.qty,'Unit Price':legacyLine.price}
    ],
    stockLots:[
      {'Tenant ID':TENANT,'Lot ID':'LOT-000101','Purchase ID':PURCHASE,
        'Product ID':CABLE,'Supplier ID':SUPPLIER,'Purchase Date':'2026-11-11',
        'Purchase Price':unitLine.price,'Original Quantity':145,
        'Remaining Quantity':140,Status:'Active'},
      {'Tenant ID':TENANT,'Lot ID':'LOT-000102','Purchase ID':PURCHASE,
        'Product ID':PIPE,'Supplier ID':SUPPLIER,'Purchase Date':'2026-11-11',
        'Purchase Price':legacyLine.price,'Original Quantity':2,
        'Remaining Quantity':1,Status:'Active'}
    ],
    unitReceipts:[{tenantId:TENANT,purchaseId:PURCHASE,productId:CABLE,
      unit:structuredClone(unitLine.unit)}]
  };
}
const audit=object=>auditHistoricalUnitLotHandoff(object);
const codes=result=>result.issues.map(x=>x.code);

test('source-faithful 1 Bag + 2 Box + 5 Pcs = 145 original Pcs; unchanged 2 Feet; supplier lots conserve',()=>{
  const s=fixture(),before=structuredClone(s);
  assert.equal(s.preflight.lines[0].qty,145);
  assert.equal(s.preflight.lines[0].unit.lineTotal,730);
  assert.equal(s.preflight.subtotal,748);
  assert.equal(s.preflight.lines[0].price,730/145);
  const r=audit(s);
  assert.equal(r.ready,true,JSON.stringify(r.issues));
  assert.equal(r.postingAllowed,false);
  assert.deepEqual(r.issues,[]);
  assert.equal(r.unitAudit.ready,true);
  assert.equal(r.lotAudit.ready,true);
  assert.equal(r.checkedProducts,2);
  assert.deepEqual(s,before,'gate may not change the historical source evidence');
});

test('a later current catalog update cannot reinterpret already captured historical receipt',()=>{
  const s=fixture(), before=structuredClone(s);
  const changed=conversionRows.map(row=>({...row,'Conversion Factor':999,'Purchase Price':999}));
  assert.equal(changed[0]['Conversion Factor'],999);
  assert.equal(audit(s).ready,true);
  assert.deepEqual(s,before);
});

test('changed historical factor is refused even if every current purchase/lot number is recalculated to remain internally consistent',()=>{
  const s=fixture();
  const line=s.preflight.lines[0];
  line.unit.unitSnapshot[0].factor=120;
  line.unit.pricingSnapshot[0].factor=120;
  line.qty=165;
  line.price=730/165;
  s.purchaseItems[0].Quantity=165;
  s.purchaseItems[0]['Unit Price']=line.price;
  s.stockLots[0]['Original Quantity']=165;
  s.stockLots[0]['Purchase Price']=line.price;
  // A direct unit-preflight / purchase-lot check would accept this counterfeit.
  const r=audit(s);
  assert.equal(r.unitAudit.ready,true,JSON.stringify(r.unitAudit.issues));
  assert.equal(r.lotAudit.ready,true,JSON.stringify(r.lotAudit.issues));
  assert.equal(r.ready,false);
  assert.ok(codes(r).includes('UNIT_RECEIPT_MISMATCH'));
});

test('historical unit price cannot be silently rewritten when other source quantities still agree',()=>{
  const s=fixture();
  s.preflight.lines[0].unit.pricingSnapshot[0].unitPrice=501;
  const r=audit(s);
  assert.equal(r.ready,false);
  assert.ok(codes(r).includes('UNIT_RECEIPT_MISMATCH'));
});

test('advanced unit line without independent receipt is NEEDS_REVIEW; legacy-only line needs none',()=>{
  const s=fixture();
  s.unitReceipts=[];
  const missing=audit(s);
  assert.equal(missing.ready,false);
  assert.ok(codes(missing).includes('MISSING_UNIT_RECEIPT'));
  s.preflight.lines=s.preflight.lines.filter(line=>line.productId===PIPE);
  s.purchaseItems=s.purchaseItems.filter(line=>line['Product ID']===PIPE);
  s.stockLots=s.stockLots.filter(lot=>lot['Product ID']===PIPE);
  s.preflight.subtotal=18;
  const legacy=audit(s);
  assert.equal(legacy.ready,true,JSON.stringify(legacy.issues));
  assert.equal(legacy.unitAudit.summary.legacyLines,1);
  assert.equal(legacy.checkedProducts,1);
});

test('a source Purchase Item changed after historical unit receipt cannot be silently repaired',()=>{
  const s=fixture();s.purchaseItems[0].Quantity=146;
  const r=audit(s);
  assert.equal(r.ready,false);
  assert.ok(codes(r).includes('STORED_QUANTITY_MISMATCH'));
  assert.ok(codes(r).includes('ORIGINAL_QUANTITY_MISMATCH'));
});

test('original lot cost and stored purchase line cost must be identical to trusted source preflight',()=>{
  const s=fixture();s.stockLots[0]['Purchase Price']=7;
  assert.ok(codes(audit(s)).includes('PURCHASE_COST_MISMATCH'));
  s.stockLots[0]['Purchase Price']=s.preflight.lines[0].price;
  s.purchaseItems[0]['Unit Price']=7;
  assert.ok(codes(audit(s)).includes('STORED_UNIT_COST_MISMATCH'));
});

test('supplier must match the stored purchase header and source lots; never infer by name',()=>{
  const s=fixture();s.purchaseHeader['Supplier ID']='SUP-OTHER';
  assert.ok(codes(audit(s)).includes('SUPPLIER_ID_MISMATCH'));
  s.purchaseHeader['Supplier ID']=SUPPLIER;
  s.stockLots[0]['Supplier ID']='SUP-OTHER';
  assert.ok(codes(audit(s)).includes('SUPPLIER_MISMATCH'));
});

test('foreign Tenant, Purchase, Product or receipt cannot mix source identities',()=>{
  for(const [field,index,key,value] of [
    ['purchaseHeader',null,'Tenant ID','OTHER'],
    ['purchaseItems',0,'Tenant ID','OTHER'],
    ['stockLots',0,'Tenant ID','OTHER'],
    ['unitReceipts',0,'tenantId','OTHER'],
    ['stockLots',0,'Purchase ID','PUR-OTHER'],
    ['purchaseItems',0,'Product ID','PRD-OTHER']
  ]){
    const s=fixture(),row=index===null?s[field]:s[field][index];
    row[key]=value;
    const r=audit(s);
    assert.equal(r.ready,false,field+'.'+key);
    assert.equal(r.postingAllowed,false);
    assert.ok(codes(r).some(code=>/SCOPE|PRODUCT|MISSING|UNEXPECTED/.test(code)),
      JSON.stringify(r.issues));
  }
});

test('duplicate unit receipt, duplicate Stock Lot and extra unaccounted purchase line never pass',()=>{
  const s=fixture();s.unitReceipts.push(structuredClone(s.unitReceipts[0]));
  assert.ok(codes(audit(s)).includes('DUPLICATE_UNIT_RECEIPT'));
  s.unitReceipts.pop();s.stockLots.push({...s.stockLots[0]});
  assert.ok(codes(audit(s)).includes('DUPLICATE_LOT_ID'));
  s.stockLots.pop();
  s.purchaseItems.push({'Tenant ID':TENANT,'Purchase ID':PURCHASE,'Product ID':'NEW',
    Quantity:1,'Unit Price':1});
  assert.ok(codes(audit(s)).includes('UNEXPECTED_STORED_PRODUCT'));
});

test('missing Lot, unknown purchased product and soft-deleted purchase never get posting authority',()=>{
  const s=fixture();
  s.stockLots.pop();
  assert.ok(codes(audit(s)).includes('MISSING_PURCHASE_LOT'));
  s.stockLots=fixture().stockLots;
  s.purchaseHeader['Is Deleted']='TRUE';
  assert.ok(codes(audit(s)).includes('DELETED_PURCHASE_REVIEW'));
});

test('valid legacy purchase cannot receive phantom unit history that was not present in source',()=>{
  const s=fixture();
  s.unitReceipts.push({tenantId:TENANT,purchaseId:PURCHASE,productId:PIPE,
    unit:structuredClone(s.preflight.lines[0].unit)});
  const r=audit(s);
  assert.equal(r.ready,false);
  assert.ok(codes(r).includes('UNEXPECTED_UNIT_RECEIPT'));
});

test('accessors, sparse arrays, ambiguous IDs, nonfinite quantity and missing snapshots fail closed',()=>{
  assert.throws(()=>audit(),/snapshot|object/i);
  const s=fixture();s.tenantId=' ';
  assert.throws(()=>audit(s),/tenant/i);
  const a=fixture();a.unitReceipts=Array(1);
  assert.throws(()=>audit(a),/sparse|receipt|array/i);
  const b=fixture(); b.purchaseItems[0]=Object.defineProperty({},'Product ID',{
    get(){throw new Error('MUST NOT EXECUTE GETTER');}
  });
  assert.throws(()=>audit(b),/accessor|row|trusted/i);
  const c=fixture(); c.preflight.lines[0].qty=Infinity;
  assert.equal(audit(c).ready,false);
  assert.equal(audit(c).postingAllowed,false);
});

test('pure bridge is not registered in the Worker or financial posting kernel',()=>{
  const source=readFileSync(new URL('../src/modules/m05-historical-unit-lot-handoff.js',import.meta.url),'utf8');
  const publicCode=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  assert.doesNotMatch(publicCode,/auditHistoricalUnitLotHandoff|m05-historical-unit-lot-handoff/);
  assert.doesNotMatch(source,/SpreadsheetApp|LockService|\.prepare\s*\(|\.batch\s*\(|\.exec\s*\(|\bfetch\s*\(|\.put\s*\(/);
  assert.equal(audit(fixture()).postingAllowed,false);
});
