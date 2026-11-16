import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  CANONICAL_PRODUCT_HEADERS,
  SUPPLEMENTARY_PRODUCT_HEADERS,
  SUPPLEMENTARY_CONVERSION_HEADERS,
  snapshotProductTextRows,
  snapshotConversionTextRows,
} from '../src/db/product-source-contract.js';

const canonical = [
  'Product ID','Product Name','Brand','Category','Unit','Barcode','Purchase Price',
  'Selling Price','Current Stock','Minimum Stock','Status','Created At','Updated At',
  'Is Deleted','Deleted By','Deleted At','Delete Reason','Product Type','Bundle Revision'
];
const supplementary = [
  ...canonical.slice(0,17),
  'Purchase Price Unit','Selling Price Unit','Stock Unit Purchase Price Override',
  'Stock Unit Selling Price Override','Stock View Unit','Stock Entry Unit','Minimum Stock Unit'
];
const conversions = [
  'Conversion ID','Product ID','Unit Name','Conversion Factor','Relation Qty',
  'Relation Unit Name','Purchase Price','Selling Price','Sort Order','Status',
  'Created At','Updated At'
];
const row = (headers, changes={}) => headers.map(k=>Object.hasOwn(changes,k) ? changes[k] : '');
const original = (id,changes={}) => row(canonical, {'Product ID':id,'Product Name':'ক্যাবল','Unit':'Gira',
  'Barcode':'001234','Purchase Price':'4.375','Selling Price':'25.00',
  'Current Stock':'37.000','Minimum Stock':'0.50',...changes});

test('pins canonical 19-field source and separate 24/12-field optional source profiles',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
  const frozen=manifest.tables.find(x=>x.sheetKey==='PRODUCTS');
  assert.deepEqual(frozen.columns,canonical);
  assert.deepEqual(CANONICAL_PRODUCT_HEADERS,canonical);
  assert.deepEqual(SUPPLEMENTARY_PRODUCT_HEADERS,supplementary);
  assert.deepEqual(SUPPLEMENTARY_CONVERSION_HEADERS,conversions);
});

test('preserves physical rows, Unicode, barcode zeros and exact decimal strings without identity merging',()=>{
  const a=snapshotProductTextRows({headers:canonical,rows:[
    original('P-001'),original('P-002',{'Product Name':'ক্যাবল','Barcode':'001234'})
  ]});
  assert.deepEqual(a.map(x=>[x.sourceSheetRow,x.sourceId]),[[2,'P-001'],[3,'P-002']]);
  assert.equal(a[0].fields.Barcode,'001234');
  assert.equal(a[0].fields['Purchase Price'],'4.375');
  assert.equal(a[0].fields['Current Stock'],'37.000');
  assert.equal(a[0].fields['Product Name'],'ক্যাবল');
  assert.equal(a[1].fields.Barcode,'001234');
});

test('fail closed on wrong, missing, extra or reordered original source headers',()=>{
  for(const headers of [canonical.slice(0,-1),[...canonical,'Extra'],[canonical[1],canonical[0],...canonical.slice(2)],supplementary])
    assert.throws(()=>snapshotProductTextRows({headers,rows:[]}),/header|profile/i);
});

test('rejects malformed width, nontext money/barcode, missing and duplicate original IDs',()=>{
  assert.throws(()=>snapshotProductTextRows({headers:canonical,rows:[original('P1').slice(0,-1)]}),/width/i);
  assert.throws(()=>snapshotProductTextRows({headers:canonical,rows:[original('P1',{'Purchase Price':4.375})]}),/text/i);
  assert.throws(()=>snapshotProductTextRows({headers:canonical,rows:[original('P1',{'Barcode':1234})]}),/text/i);
  assert.throws(()=>snapshotProductTextRows({headers:canonical,rows:[original('')]}),/Product ID/i);
  assert.throws(()=>snapshotProductTextRows({headers:canonical,rows:[original('P1'),original('P1')]}),/duplicate/i);
});

test('older feature product profile must be explicitly reviewed; never inferred as canonical',()=>{
  const extended=row(supplementary,{'Product ID':'P-S','Product Name':'গেজ',
    'Unit':'Gira','Purchase Price Unit':'Gauge','Stock View Unit':'Gauge'});
  assert.throws(()=>snapshotProductTextRows({headers:supplementary,rows:[extended]}),/header|profile/i);
  assert.throws(()=>snapshotProductTextRows({profile:'supplementary',headers:supplementary,rows:[extended]}),/review|approval/i);
  const a=snapshotProductTextRows({
    profile:'supplementary',explicitSupplementaryReview:true,
    headers:supplementary,rows:[extended]
  });
  assert.equal(a[0].sourceId,'P-S');
  assert.equal(a[0].fields['Stock View Unit'],'Gauge');
  assert.equal(a[0].fields['Product Type'],undefined);
});

test('supplementary conversions require reviewed Product IDs and preserve factors/prices as text',()=>{
  const c=row(conversions,{'Conversion ID':'C-GAUGE','Product ID':'P-S',
    'Unit Name':'Gauge','Conversion Factor':'16.000','Relation Qty':'16',
    'Relation Unit Name':'Gira','Purchase Price':'70.000','Selling Price':'400'});
  assert.throws(()=>snapshotConversionTextRows({headers:conversions,rows:[c]}),/review|approved/i);
  assert.throws(()=>snapshotConversionTextRows({headers:conversions,rows:[c],approvedProductIds:new Set(['P-other'])}),/Product ID|approved/i);
  const a=snapshotConversionTextRows({headers:conversions,rows:[c],
    approvedProductIds:new Set(['P-S'])});
  assert.deepEqual([a[0].sourceSheetRow,a[0].sourceId],[2,'C-GAUGE']);
  assert.equal(a[0].fields['Conversion Factor'],'16.000');
  assert.equal(a[0].fields['Purchase Price'],'70.000');
});

test('duplicate conversion IDs or unit labels within a product fail rather than overwrite',()=>{
  const c=row(conversions,{'Conversion ID':'C1','Product ID':'P1','Unit Name':'Gauge',
    'Conversion Factor':'16'});
  const dupId=row(conversions,{'Conversion ID':'C1','Product ID':'P1','Unit Name':'Box',
    'Conversion Factor':'20'});
  const dupUnit=row(conversions,{'Conversion ID':'C2','Product ID':'P1','Unit Name':'gauge',
    'Conversion Factor':'16'});
  for(const second of [dupId,dupUnit]) assert.throws(()=>snapshotConversionTextRows({
    headers:conversions,rows:[c,second],approvedProductIds:new Set(['P1'])
  }),/duplicate/i);
});

test('max 1000 rows and nonnumeric original ID string are bounded and preserved',()=>{
  assert.throws(()=>snapshotProductTextRows({headers:canonical,
    rows:Array.from({length:1001},(_,i)=>original(String(i)))}),/1000|bound/i);
  const a=snapshotProductTextRows({headers:canonical,rows:[original('0001')]});
  assert.equal(a[0].sourceId,'0001');
});
