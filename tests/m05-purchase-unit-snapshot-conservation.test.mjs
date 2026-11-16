import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareMultiUnitPurchasePaymentPreflight} from
  '../src/modules/m05-multi-unit-purchase-payment.js';
import {auditMultiUnitPurchaseSnapshot} from
  '../src/modules/m05-purchase-unit-snapshot-conservation.js';

const products=[
  {'Product ID':'P-CABLE','Product Name':'Cable','Product Type':'Standard',
    Unit:'Pcs','Purchase Price':6,'Selling Price':10,'Current Stock':5,_rowIndex:7},
  {'Product ID':'P-PIPE','Product Name':'Pipe','Product Type':'Standard',
    Unit:'Feet','Purchase Price':9,'Selling Price':14,'Current Stock':-4,_rowIndex:8}
];
const suppliers=[{'Supplier ID':'SUP-A','Supplier Name':'Supplier A',Status:'Active'}];
const conversionRows=[
  {'Conversion ID':'C-BAG','Product ID':'P-CABLE','Unit Name':'Bag',
    'Conversion Factor':100,'Purchase Price':500,'Sort Order':1,Status:'Active'},
  {'Conversion ID':'C-BOX','Product ID':'P-CABLE','Unit Name':'Box',
    'Conversion Factor':20,'Purchase Price':100,'Sort Order':2,Status:'Active'}
];
const bankAccounts=[{'Bank Account ID':'BA-1','Account Name':'Bank A',Status:'Active'}];
const multiLine=(extra={})=>({
  productId:'P-CABLE',name:'Client supplied',qty:145,unitPrice:1,sellingPrice:10,
  unitBreakdown:[
    {conversionId:'C-BAG',qty:1},{conversionId:'C-BOX',qty:2},
    {conversionId:'BASE',qty:5}
  ],...extra
});
const legacyLine=(extra={})=>({
  productId:'P-PIPE',name:'Pipe',qty:2,unitPrice:9,sellingPrice:14,...extra
});
const payload=(extra={})=>({
  supplierId:'SUP-A',items:[multiLine(),legacyLine()],discount:8,
  paidAmount:100,paymentMethod:'Bank',bankAccountId:'BA-1',...extra
});
const rows=()=>({products,suppliers,conversionRows,bankAccounts});
const preflight=(input=payload(),context=rows())=>
  prepareMultiUnitPurchasePaymentPreflight(input,context);
const report=result=>auditMultiUnitPurchaseSnapshot(result);
const codes=result=>report(result).issues.map(issue=>issue.code);

test('source pricing snapshot formulas are present in merged approved unit core and frozen purchase',()=>{
  const units=readFileSync(new URL('../src/modules/product-unit-conversions.js',import.meta.url),'utf8');
  const source=readFileSync(new URL('../legacy/source/Purchase.gs',import.meta.url),'utf8');
  assert.match(units,/baseQty \+= item\.qty \* item\.factor/);
  assert.match(units,/lineTotalRaw \+= \(Number\(component\.qty\) \|\| 0\) \* unitPrice/);
  assert.match(units,/unitPrice: baseQty > 0 \? lineTotal \/ baseQty : 0/);
  assert.match(source,/subtotal \+= qty \* price/);
});

test('trusted mixed-unit purchase: 1 Bag, 2 Box, 5 Pcs plus pipe conserves 145 base units and 730 BDT',()=>{
  const result=preflight(),before=structuredClone(result);
  assert.deepEqual(report(result),{
    ready:true,issues:[],summary:{
      lines:2,unitLines:1,legacyLines:1,
      auditedBaseQuantity:145,auditedUnitLineTotal:730,
      amountTolerance:0.0000001
    }
  });
  assert.equal(result.subtotal,748);
  assert.equal(result.dueAmount,640);
  assert.deepEqual(result,before);
});

test('changing later catalog conversion and cost cannot rewrite an accepted historical snapshot',()=>{
  const result=preflight(),before=structuredClone(result);
  const changed=conversionRows.map(r=>({...r,'Conversion Factor':999,'Purchase Price':999}));
  assert.notEqual(changed[0]['Conversion Factor'],before.lines[0].unit.unitSnapshot[0].factor);
  assert.equal(report(result).ready,true);
  assert.deepEqual(result,before);
});

test('base purchase quantity drift is detected independently of component price',()=>{
  const result=preflight();
  result.lines[0].qty=146;
  assert.ok(codes(result).includes('BASE_QUANTITY_MISMATCH'));
  assert.equal(report(result).ready,false);
});

test('a changed snapshot factor is refused even when original line prices look plausible',()=>{
  const result=preflight();
  result.lines[0].unit.unitSnapshot[0].factor=1;
  assert.ok(codes(result).includes('COMPONENT_MISMATCH'));
  assert.ok(codes(result).includes('BASE_QUANTITY_MISMATCH'));
});

test('pricing snapshot drift of one paisa is detected without looking up latest catalog',()=>{
  const result=preflight();
  result.lines[0].unit.pricingSnapshot[0].unitPrice=500.01;
  assert.ok(codes(result).includes('UNIT_LINE_TOTAL_MISMATCH'));
  assert.equal(report(result).ready,false);
});

test('base unit cost rate must conserve the exact rounded unit breakdown total',()=>{
  const result=preflight();
  result.lines[0].price=5;
  assert.ok(codes(result).includes('BASE_UNIT_COST_MISMATCH'));
  assert.equal(report(result).ready,false);
});

test('unit components require matching original conversion IDs, labels, quantities and factors',()=>{
  const result=preflight();
  result.lines[0].unit.pricingSnapshot[1].conversionId='DIFFERENT';
  assert.ok(codes(result).includes('COMPONENT_MISMATCH'));
  result.lines[0].unit.pricingSnapshot[1].conversionId='C-BOX';
  result.lines[0].unit.unitSnapshot[1].conversionId='C-BAG';
  assert.ok(codes(result).includes('DUPLICATE_UNIT_CONVERSION'));
});

test('missing component, zero factor, negative unit price and unsafe numeric values fail closed',()=>{
  const result=preflight();
  result.lines[0].unit.unitSnapshot[0].factor=0;
  assert.ok(codes(result).includes('INVALID_UNIT_COMPONENT'));
  result.lines[0].unit.unitSnapshot[0].factor=100;
  result.lines[0].unit.pricingSnapshot[0].unitPrice=-1;
  assert.ok(codes(result).includes('INVALID_UNIT_PRICE'));
  result.lines[0].unit.pricingSnapshot[0].unitPrice=500;
  result.lines[0].unit.unitSnapshot[0].qty=Infinity;
  assert.ok(codes(result).includes('INVALID_UNIT_COMPONENT'));
});

test('missing paired unit/pricing snapshots and duplicate product line IDs are review-only blockers',()=>{
  const result=preflight();
  result.lines[0].unit.pricingSnapshot=[];
  assert.ok(codes(result).includes('INCOMPLETE_UNIT_SNAPSHOT'));
  const another=preflight();
  another.lines.push({...another.lines[0]});
  assert.ok(codes(another).includes('DUPLICATE_PURCHASE_PRODUCT'));
});

test('overall invoice subtotal is reconciled using mixed-unit rounded totals and legacy line values',()=>{
  const result=preflight();
  result.subtotal=749;
  assert.ok(codes(result).includes('PURCHASE_SUBTOTAL_MISMATCH'));
  assert.equal(report(result).ready,false);
});

test('native roundMoney 2-decimal component total works with fractional multi-unit cost',()=>{
  const input=payload({discount:0,paidAmount:0,items:[
    multiLine({qty:3,unitBreakdown:[{conversionId:'C-BAG',qty:1}]})
  ]});
  const custom=[{...conversionRows[0],'Conversion Factor':3,'Purchase Price':0.335}];
  const result=preflight(input,{...rows(),conversionRows:custom});
  assert.equal(result.lines[0].unit.lineTotal,0.34);
  assert.equal(result.lines[0].qty,3);
  assert.equal(report(result).ready,true);
});

test('legacy no-breakdown purchase remains acceptable without fabricating unit evidence',()=>{
  const result=preflight(payload({items:[legacyLine()],discount:0,paidAmount:0}));
  assert.equal(result.lines[0].unit,undefined);
  const outcome=report(result);
  assert.equal(outcome.ready,true);
  assert.equal(outcome.summary.legacyLines,1);
  assert.equal(outcome.summary.unitLines,0);
  assert.equal(outcome.summary.auditedUnitLineTotal,0);
});

test('missing or accessor-bearing trusted preview data throws, never executes getters',()=>{
  assert.throws(()=>report(),/trusted.*preflight/i);
  assert.throws(()=>report({lines:null}),/preflight/i);
  const result=preflight();
  result.lines[0].unit.pricingSnapshot[0]=Object.defineProperty({},'unitPrice',{
    get(){throw Error('getter invoked');}
  });
  assert.throws(()=>report(result),/accessor|snapshot/i);
});

test('a malformed declared unit field cannot be downgraded to an ordinary legacy single-unit line',()=>{
  const result=preflight();
  result.lines[0].unit=null;
  assert.ok(codes(result).includes('INCOMPLETE_UNIT_SNAPSHOT'));
  result.lines[0].unit={};
  assert.ok(codes(result).includes('INCOMPLETE_UNIT_SNAPSHOT'));
});

test('pure math-only report cannot expose public Worker RPC or D1 mutations',()=>{
  const runtime=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.doesNotMatch(runtime,/auditMultiUnitPurchaseSnapshot|m05-purchase-unit-snapshot-conservation/);
  const result=report(preflight());
  assert.equal('operationId' in result,false);
  assert.equal('ledger' in result,false);
});
