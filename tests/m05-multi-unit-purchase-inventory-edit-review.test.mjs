import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareMultiUnitPurchasePreflight} from '../src/modules/m05-multi-unit-purchase-preflight.js';
import {planPurchaseInventoryEdit} from '../src/modules/purchase-correction-guards.js';
import {reviewMultiUnitPurchaseInventoryEdit} from
  '../src/modules/m05-multi-unit-purchase-inventory-edit-review.js';

const products=[
  {'Product ID':'P-MIX','Product Name':'Cable','Product Type':'Standard',
    'Unit':'Pcs','Purchase Price':6,'Selling Price':10,
    'Current Stock':125,'Is Deleted':'FALSE',_rowIndex:6},
  {'Product ID':'P-LEGACY','Product Name':'Switch','Product Type':'Standard',
    'Unit':'Pcs','Purchase Price':3,'Selling Price':5,
    'Current Stock':4,'Is Deleted':'FALSE',_rowIndex:7},
  {'Product ID':'P-BUNDLE','Product Name':'Virtual bundle','Product Type':'Bundle',
    'Unit':'Set','Current Stock':0,_rowIndex:8}
];
const suppliers=[
  {'Supplier ID':'SUP-A','Supplier Name':'Supplier A',Status:'Active'},
  {'Supplier ID':'SUP-B','Supplier Name':'Supplier B',Status:'Active'},
  {'Supplier ID':'SUP-INACTIVE','Supplier Name':'Inactive supplier',Status:'Inactive'}
];
const conversionRows=[
  {'Conversion ID':'C-BAG','Product ID':'P-MIX','Unit Name':'Bag',
    'Conversion Factor':100,'Purchase Price':600,'Sort Order':1,Status:'Active'},
  {'Conversion ID':'C-BOX','Product ID':'P-MIX','Unit Name':'Box',
    'Conversion Factor':20,'Purchase Price':120,'Sort Order':2,Status:'Active'}
];
const initial=()=>({
  purchases:[{'Purchase ID':'PUR-001','Supplier ID':'SUP-A','Date':'2026-11-10','Is Deleted':'FALSE'}],
  items:[{'Purchase ID':'PUR-001','Product ID':'P-MIX','Product Name':'Cable','Quantity':145,'Unit Price':6,'Sell Price':10}],
  lots:[{'Purchase ID':'PUR-001','Lot ID':'LOT-MIX','Product ID':'P-MIX',
    'Original Quantity':145,'Remaining Quantity':125,'Purchase Price':6,'Status':'Active'}],
  returns:[]
});
const snapshot=()=>({products,suppliers,conversionRows,...initial()});
const input=(extra={})=>({
  supplierId:'SUP-A',items:[{
    productId:'P-MIX',name:'Client label',qty:140,unitPrice:0.001,sellingPrice:10,
    unitBreakdown:[{conversionId:'C-BAG',qty:1},{conversionId:'C-BOX',qty:2}]
  }],discount:0,paidAmount:0,...extra
});
const legacy=(extra={})=>({
  productId:'P-LEGACY',name:'Switch',qty:5,unitPrice:3,sellingPrice:5,...extra
});
const review=(proposal=input(),data=snapshot())=>
  reviewMultiUnitPurchaseInventoryEdit('PUR-001',proposal,data);

test('frozen Purchase Update source guards and merged optional unit core are unchanged',()=>{
  const source=readFileSync(new URL('../legacy/source/PurchaseManagement.gs',import.meta.url),'utf8');
  const module=readFileSync(new URL('../src/modules/product-unit-conversions.js',import.meta.url),'utf8');
  assert.match(source,/const delta = newQty - oldQty/);
  assert.match(source,/if \(remaining < Math\.abs\(delta\)\)/);
  assert.match(source,/Purchase price cannot be changed after stock from this lot has already been sold/);
  assert.match(module,/baseQty \+= item\.qty \* item\.factor/);
});

test('source-consistent mixed units reduce 145→140 base Pcs and keep sold-lot cost immutable',()=>{
  const data=snapshot(),proposal=input();
  const before=structuredClone({data,proposal});
  const result=review(proposal,data);
  assert.equal(result.mode,'preflight-only');
  assert.equal(result.purchase.supplierId,'SUP-A');
  assert.equal(result.purchase.lines[0].qty,140);
  assert.equal(result.purchase.lines[0].price,6);
  assert.equal(result.purchase.lines[0].unit.lineTotal,840);
  assert.equal(result.purchase.subtotal,840);
  assert.deepEqual(result.inventory,{
    stockChanges:[{productId:'P-MIX',delta:-5,newStock:120}],
    costChanges:[]
  });
  assert.deepEqual({data,proposal},before);
  assert.equal('operationId' in result,false);
  assert.equal('journal' in result,false);
});

test('valid 145→15 reduction is refused because 20 units from this original lot were sold',()=>{
  const changed=input({items:[{
    ...input().items[0],qty:15,
    unitBreakdown:[{conversionId:'BASE',qty:15}]
  }]});
  assert.throws(()=>review(changed),/only 125 of the 145 bought.*cannot be reduced by 130/i);
});

test('cost of partly consumed lot cannot change when trusted conversion unit purchase price changes',()=>{
  const data=snapshot();
  data.conversionRows=conversionRows.map(r=>({...r,
    'Purchase Price':r['Conversion ID']==='C-BAG'?700:r['Purchase Price']
  }));
  assert.throws(()=>review(input(),data),
    /Purchase price cannot be changed after stock from this lot has already been sold/);
});

test('price-only edit on unsold lot accepted and separately tracked as original cost correction',()=>{
  const data=snapshot();
  data.lots[0]['Remaining Quantity']=145;
  data.products=products.map(p=>p['Product ID']==='P-MIX'
    ? {...p,'Current Stock':145}:p);
  data.conversionRows=conversionRows.map(r=>({...r,
    'Purchase Price':r['Conversion ID']==='C-BAG'?700:r['Purchase Price']
  }));
  const sameQty=input({items:[{
    ...input().items[0],qty:145,
    unitBreakdown:[{conversionId:'C-BAG',qty:1},
      {conversionId:'C-BOX',qty:2},{conversionId:'BASE',qty:5}]
  }]});
  const result=review(sameQty,data);
  assert.equal(result.inventory.stockChanges.length,0);
  assert.equal(result.inventory.costChanges.length,1);
  assert.equal(result.inventory.costChanges[0].productId,'P-MIX');
  assert.equal(result.inventory.costChanges[0].newPrice,970/145);
});

test('added legacy product uses original Current Stock delta guard with multi-unit line',()=>{
  const result=review(input({items:[...input().items,legacy()]}));
  assert.deepEqual(result.inventory.stockChanges,[
    {productId:'P-MIX',delta:-5,newStock:120},
    {productId:'P-LEGACY',delta:5,newStock:9}
  ]);
  assert.equal(result.purchase.subtotal,855);
  assert.equal(result.purchase.lines[1].unit,undefined);
});

test('existing purchase with only legacy units produces same guard decisions as original helper',()=>{
  const data=snapshot();
  data.items=[{
    'Purchase ID':'PUR-001','Product ID':'P-LEGACY','Product Name':'Switch',
    'Quantity':4,'Unit Price':3
  }];
  data.lots=[{'Purchase ID':'PUR-001','Lot ID':'LOT-LEGACY',
    'Product ID':'P-LEGACY','Original Quantity':4,'Remaining Quantity':4}];
  const proposal=input({items:[legacy()]});
  const result=review(proposal,data);
  const original=planPurchaseInventoryEdit('PUR-001',data,[legacy()]);
  assert.deepEqual(result.inventory,original);
  assert.deepEqual(result.purchase,
    prepareMultiUnitPurchasePreflight(proposal,{products,suppliers,conversionRows}));
});

test('Purchase Return and soft-deleted header preserve original source edit locks',()=>{
  const data=snapshot();
  data.returns.push({'Purchase ID':'PUR-001','Return ID':'PR-1','Is Deleted':'FALSE'});
  assert.throws(()=>review(input(),data),/Purchase Return records.*no longer be updated/i);
  data.returns[0]['Is Deleted']='TRUE';
  data.purchases[0]['Is Deleted']='TRUE';
  assert.throws(()=>review(input(),data),/purchase has been deleted/i);
});

test('supplier reassignment is held for financial-settlement review rather than silently moved',()=>{
  assert.throws(()=>review(input({supplierId:'SUP-B'})),
    /supplier reassignment.*review/i);
  assert.throws(()=>review(input({supplierId:'SUP-INACTIVE'})),
    /Supplier not found or inactive/i);
});

test('ambiguous source purchase IDs, product IDs or conversions cannot be selected by first match',()=>{
  const dupPurchase=snapshot();
  dupPurchase.purchases.push({...dupPurchase.purchases[0]});
  assert.throws(()=>review(input(),dupPurchase),/duplicate purchase id/i);
  const dupProduct=snapshot();
  dupProduct.products=[...products,{...products[0]}];
  assert.throws(()=>review(input(),dupProduct),/duplicate product id/i);
  const dupConversion=snapshot();
  dupConversion.conversionRows=[...conversionRows,{...conversionRows[0]}];
  assert.throws(()=>review(input(),dupConversion),/duplicate conversion id/i);
});

test('duplicate source lot ambiguity and sold-lot cost guard are never bypassed by mixed units',()=>{
  const data=snapshot();
  data.lots.push({...data.lots[0],'Lot ID':'LOT-MIX-DUP'});
  assert.throws(()=>review(input(),data),/ambiguous purchase stock lots/i);
});

test('browser factor/price tampering cannot alter base quantity/cost or inventory review',()=>{
  const altered=input({items:[{
    ...input().items[0],unitPrice:99999,name:'Spoof',qty:undefined,
    unitBreakdown:[{conversionId:'C-BOX',qty:2,factor:1,unitPrice:0},
      {conversionId:'C-BAG',qty:1,factor:1,unitPrice:0}]
  }]});
  const result=review(altered);
  assert.equal(result.purchase.lines[0].qty,140);
  assert.equal(result.purchase.lines[0].price,6);
  assert.equal(result.purchase.lines[0].unit.lineTotal,840);
});

test('invalid foreign/inactive conversion and virtual bundles keep original purchase validations',()=>{
  const data=snapshot();
  data.conversionRows=conversionRows.map(r=>({...r,Status:'Inactive'}));
  assert.throws(()=>review(input(),data),/conversion is not available/i);
  const bundle=input({items:[{productId:'P-BUNDLE',name:'Bundle',qty:1,
    unitPrice:100,sellingPrice:101}]});
  assert.throws(()=>review(bundle),/Virtual bundle/i);
});

test('missing trusted arrays, getters or partial payload cannot run an inventory review',()=>{
  assert.throws(()=>review(input(),{...snapshot(),lots:null}),/trusted.*lot snapshot/i);
  assert.throws(()=>review(input(),{...snapshot(),returns:undefined}),/trusted.*return snapshot/i);
  const accessor=Object.defineProperty({},'Product ID',{get(){throw Error('getter fired')}});
  assert.throws(()=>review(input(),{...snapshot(),items:[accessor]}),
    /trusted.*item.*accessor|trusted.*item.*row/i);
  const p=input();
  Object.defineProperty(p.items[0],'qty',{get(){throw Error('getter fired')}});
  assert.throws(()=>review(p),/payload.*accessor/i);
  assert.throws(()=>review(null),/payload/i);
});

test('no public RPC, direct DB or source mutation in the new review module',()=>{
  const runtime=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  const source=readFileSync(new URL(
    '../src/modules/m05-multi-unit-purchase-inventory-edit-review.js',import.meta.url),'utf8');
  assert.doesNotMatch(runtime,/reviewMultiUnitPurchaseInventoryEdit|m05-multi-unit-purchase-inventory-edit-review/);
  assert.doesNotMatch(source,/SpreadsheetApp|LockService|\.batch\s*\(|\.run\s*\(|\.put\s*\(|D1Database/);
});
