import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareMultiUnitPurchasePaymentPreflight} from
  '../src/modules/m05-multi-unit-purchase-payment.js';
import {auditMultiUnitPurchaseSnapshot} from
  '../src/modules/m05-purchase-unit-snapshot-conservation.js';
import {planConsistentStockPreview} from
  '../src/modules/m05-fifo-eligibility-gate.js';
import {projectTileStockView} from
  '../src/modules/m05-tile-stock-view.js';
import {auditTileLotStock} from
  '../src/modules/m05-tile-lot-revision-reconciliation.js';

const products=[
  {'Product ID':'P-MIX','Product Name':'Cable','Product Type':'Standard',
    Unit:'Pcs','Purchase Price':6,'Selling Price':10,'Current Stock':5,_rowIndex:8},
  {'Product ID':'P-PLAIN','Product Name':'Pipe','Product Type':'Standard',
    Unit:'Feet','Purchase Price':7,'Selling Price':12,'Current Stock':-3,_rowIndex:9}
];
const suppliers=[
  {'Supplier ID':'SUP-A','Supplier Name':'Supplier A',Status:'Active'},
  {'Supplier ID':'SUP-INACTIVE','Supplier Name':'Inactive',Status:'Inactive'}
];
const conversionRows=[
  {'Conversion ID':'C-BAG','Product ID':'P-MIX','Unit Name':'Bag','Conversion Factor':100,
    'Purchase Price':500,'Selling Price':900,'Sort Order':1,Status:'Active'},
  {'Conversion ID':'C-BOX','Product ID':'P-MIX','Unit Name':'Box','Conversion Factor':20,
    'Purchase Price':100,'Selling Price':190,'Sort Order':2,Status:'Active'}
];
const bankAccounts=[{'Bank Account ID':'BA-1','Account Name':'Bank A',Status:'Active'}];
const rows=()=>({products,suppliers,conversionRows,bankAccounts});
const mixed=()=>({productId:'P-MIX',name:'Browser fake',qty:145,unitPrice:0.01,
  sellingPrice:10,unitBreakdown:[
    {conversionId:'C-BAG',qty:1},{conversionId:'C-BOX',qty:2},{conversionId:'BASE',qty:5}
  ]});
const legacy=()=>({productId:'P-PLAIN',name:'Pipe',qty:2,unitPrice:9,sellingPrice:12});
const purchase=(patch={})=>({
  supplierId:'SUP-A',items:[mixed(),legacy()],discount:8,paidAmount:100,
  paymentMethod:'Bank',bankAccountId:'BA-1',...patch
});
const preview=(input=purchase(),context=rows())=>
  prepareMultiUnitPurchasePaymentPreflight(input,context);
const tileConfig=(patch={})=>({
  productId:'T-8X12',revision:'1',baseUnit:'Pcs',boxConversionId:'BOX-25',
  length:'12',width:'8',dimensionUnit:'in',piecesPerBox:'25',
  coveragePolicy:'nominal',...patch
});
const tileCatalog=(patch={})=>({
  productId:'T-8X12',baseUnitName:'Pcs',
  unitConfig:{revision:1,stockUnitName:'Pcs',conversions:[
    {conversionId:'BOX-25',unitName:'Carton',factorText:'25'}
  ]},...patch
});
const lot=(id,quantity,extra={})=>({
  lotId:id,productId:'T-8X12',remainingPcs:quantity,status:'Active',
  catalog:tileCatalog(),measurement:tileConfig(),...extra
});

test('cross-module G1 contract document contains explicit non-writer status, original source and owner gates',()=>{
  const document=readFileSync(new URL('../docs/m05/G1_SOURCE_CONTRACT_CANDIDATE.md',import.meta.url),'utf8');
  for(const required of [
    'M05-G1-SOURCE-CONTRACT-CANDIDATE-v0.1',
    'Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2',
    'sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c',
    'NOT A POSTING INTERFACE','PARALLEL-SHARED-TRANSACTION-WRITES = BLOCKED',
    'Original source IDs','Historical unit and Tiles revisions',
    'Cash Session','M03 integration owner','M04 authority','M02 identity',
    'Exactly-once replay','Party role-separated accounts','M07 returns'
  ]) assert.ok(document.includes(required),'Missing G1 handoff invariant: '+required);
});

test('mixed-unit purchase remains one 145 Pcs stock line and original independent supplier due',()=>{
  const result=preview();
  assert.equal(result.lines[0].qty,145);
  assert.equal(result.lines[0].unit.lineTotal,730);
  assert.equal(result.lines[0].unit.unitSnapshot.length,3);
  assert.deepEqual(result.lines[0].unit.unitSnapshot.map(x=>[x.factor,x.qty]),[
    [100,1],[20,2],[1,5]
  ]);
  assert.deepEqual([result.subtotal,result.discount,result.grandTotal,
    result.paidAmount,result.dueAmount],[748,8,740,100,640]);
  assert.equal(result.supplierId,'SUP-A');
  assert.equal(result.paymentMethod,'Bank');
  assert.equal(result.bankAccountId,'BA-1');
  assert.deepEqual(auditMultiUnitPurchaseSnapshot(result).issues,[]);
  assert.equal(auditMultiUnitPurchaseSnapshot(result).ready,true);
});

test('browser spoofed labels/prices/factors cannot affect trusted source conversion',()=>{
  const line=mixed();line.unitPrice=0.001;line.name='Malicious';
  line.unitBreakdown[0].factor=1;
  line.unitBreakdown[0].unitPrice=1;
  const r=preview(purchase({items:[line],discount:0,paidAmount:0}));
  assert.equal(r.lines[0].name,'Cable');
  assert.equal(r.lines[0].qty,145);
  assert.equal(r.lines[0].price,730/145);
  assert.equal(r.lines[0].unit.pricingSnapshot[0].unitPrice,500);
  assert.equal(r.dueAmount,730);
  assert.equal(r.bankAccountId,'');
});

test('legacy original single-unit purchases are not retrospectively assigned unit snapshots',()=>{
  const r=preview(purchase({items:[legacy()],discount:0,paidAmount:0}));
  assert.equal(r.lines.length,1);
  assert.equal(r.lines[0].qty,2);
  assert.equal(Object.hasOwn(r.lines[0],'unit'),false);
  const audit=auditMultiUnitPurchaseSnapshot(r);
  assert.equal(audit.ready,true);
  assert.equal(audit.summary.legacyLines,1);
  assert.equal(audit.summary.unitLines,0);
});

test('independent unit audit catches altered quantity, money and unit identity',()=>{
  const r=preview();
  r.lines[0].unit.pricingSnapshot[0].unitPrice=501;
  assert.equal(auditMultiUnitPurchaseSnapshot(r).ready,false);
  const r2=preview();
  r2.lines[0].qty=146;
  assert.ok(auditMultiUnitPurchaseSnapshot(r2).issues.some(x=>x.code==='BASE_QUANTITY_MISMATCH'));
});

test('ambiguous conversion and supplier source identities fail closed without guessing',()=>{
  assert.throws(()=>preview(purchase(),{...rows(),
    conversionRows:[...conversionRows,{...conversionRows[0]}]}),/duplicate conversion/i);
  assert.throws(()=>preview(purchase(),{...rows(),
    suppliers:[...suppliers,{...suppliers[0]}]}),/duplicate supplier/i);
  assert.throws(()=>preview(purchase({supplierId:'SUP-INACTIVE'})),/inactive/i);
});

test('source Bank route requires a matched source Bank Account ID and does not post anything',()=>{
  assert.throws(()=>preview(purchase({bankAccountId:'UNKNOWN'})),/bank account not found/i);
  const r=preview();
  assert.equal(r.paymentMethod,'Bank');
  assert.equal(Object.hasOwn(r,'operationId'),false);
  assert.equal(Object.hasOwn(r,'journal'),false);
});

test('original FIFO price eligibility refuses Deleted positive source stock',()=>{
  assert.throws(()=>planConsistentStockPreview({
    productId:'P-MIX',quantity:1,
    productRow:products[0],
    allLots:[{'Lot ID':'LOT-DELETE','Product ID':'P-MIX',
      'Remaining Quantity':5,Status:'Deleted'}]
  }),/Deleted positive-stock lot/i);
});

test('OVERSOLD signed 53 Pcs preserves 2 Cartons and 3 Pcs with exact negative Sqft',()=>{
  const view=projectTileStockView(tileCatalog(),tileConfig(),'-53');
  assert.equal(view.stockState,'oversold');
  assert.equal(view.postingAllowed,false);
  assert.equal(view.boxes,'2');
  assert.equal(view.extraPieces,'3');
  assert.deepEqual(view.actualSqft,{numerator:'-106',denominator:'3'});
});

test('original tile lots retain old measurement revision instead of applying current config',()=>{
  const old=lot('LOT-OLD','25');
  const newer=lot('LOT-NEW','24',{
    measurement:tileConfig({revision:'2',boxConversionId:'BOX-24',piecesPerBox:'24',
      length:'12',width:'12'}),
    catalog:tileCatalog({unitConfig:{
      revision:2,stockUnitName:'Pcs',conversions:[
        {conversionId:'BOX-24',unitName:'Box',factorText:'24'}]
    }})
  });
  const r=auditTileLotStock({productId:'T-8X12',cachedStockPcs:'49',lots:[old,newer]});
  assert.equal(r.ready,true);
  assert.equal(r.lotStockPcs,'49');
  assert.equal(r.areaState,'MIXED_MEASUREMENTS');
  assert.equal(r.aggregateSqft,null);
  assert.deepEqual(r.lotViews.map(x=>x.view.revision),['1','2']);
});

test('manufacturer coverage and nominal physical coverage are separately evidenced',()=>{
  const v=projectTileStockView(tileCatalog(),tileConfig({
    coveragePolicy:'manufacturer',manufacturerSqftPerBox:'16.668',
    manufacturerEvidence:'synthetic-verified-label'
  }),'450');
  assert.deepEqual(v.actualSqft,{numerator:'37503',denominator:'125'});
  assert.deepEqual(v.nominalSqft,{numerator:'300',denominator:'1'});
  assert.equal(v.measurementSnapshot.manufacturerEvidence,'synthetic-verified-label');
});

test('historical tiles cannot be repriced or re-quantified against a mismatched live revision',()=>{
  const current=tileCatalog({unitConfig:{revision:2,stockUnitName:'Pcs',conversions:[
    {conversionId:'BOX-24',unitName:'Box',factorText:'24'}
  ]}});
  assert.throws(()=>projectTileStockView(current,tileConfig(),'53'),/catalog.*mismatch/i);
});

test('read-only source helpers do not mutate trusted input nor get registered as public RPC',()=>{
  const input=purchase(),before=structuredClone({input,rows:rows()});
  const r=preview(input);
  assert.equal(r.lines[0].qty,145);
  assert.deepEqual({input,rows:rows()},before);
  const runtime=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  for(const symbol of [
    'prepareMultiUnitPurchasePaymentPreflight',
    'auditMultiUnitPurchaseSnapshot',
    'planConsistentStockPreview','projectTileStockView','auditTileLotStock'
  ]) assert.doesNotMatch(runtime,new RegExp('\\b'+symbol+'\\b'));
  const rpc=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.match(rpc,/Object\.freeze\(Object\.create\(null\)\)/);
});
