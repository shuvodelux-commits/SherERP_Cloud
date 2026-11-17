import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveTileQuantityFromCatalog} from '../src/modules/tile-quantity-contract.js';
import {projectTileStockView} from '../src/modules/m05-tile-stock-view.js';

const measurement=(patch={})=>({
  productId:'T-8X12',revision:'1',baseUnit:'Pcs',
  boxConversionId:'BOX-25',length:'12',width:'8',dimensionUnit:'in',
  piecesPerBox:'25',coveragePolicy:'nominal',...patch
});
const catalog=(patch={})=>({
  productId:'T-8X12',baseUnitName:'Pcs',
  unitConfig:{revision:1,stockUnitName:'Pcs',conversions:[
    {conversionId:'BOX-25',unitName:'Carton',factorText:'25.000'}
  ]},...patch
});
const view=(pcs,config=measurement(),source=catalog())=>
  projectTileStockView(source,config,pcs);

test('53 canonical tile Pcs display 2 Cartons + 3 Pcs and exact 106/3 Sqft',()=>{
  const out=view('53');
  assert.equal(out.mode,'read-only-stock-view');
  assert.equal(out.productId,'T-8X12');
  assert.equal(out.revision,'1');
  assert.equal(out.basePcs,'53');
  assert.equal(out.stockState,'available');
  assert.equal(out.boxes,'2');
  assert.equal(out.extraPieces,'3');
  assert.equal(out.packUnitName,'Carton');
  assert.deepEqual(out.actualSqft,{numerator:'106',denominator:'3'});
  assert.deepEqual(out.nominalSqft,{numerator:'106',denominator:'3'});
  assert.equal(out.displaySqft,'35.33');
  assert.equal(out.postingAllowed,false);
});

test('physical stock view reuses exact catalog-bound quantity and has no rounding drift',()=>{
  const config=measurement(),source=catalog();
  const ref=resolveTileQuantityFromCatalog(source,config,{
    mode:'pack',boxes:'2',extraPieces:'3'
  });
  const out=view('53',config,source);
  assert.deepEqual(out.actualSqft,ref.actualSqft);
  assert.deepEqual(out.nominalSqft,ref.nominalSqft);
  assert.equal(out.measurementSnapshot.boxUnitName,ref.measurementSnapshot.boxUnitName);
  assert.equal(out.displaySqft,ref.displaySqft);
});

test('zero stock keeps verified measurement revision but shows zero without fake receipt',()=>{
  const out=view('0');
  assert.equal(out.stockState,'zero');
  assert.equal(out.boxes,'0');
  assert.equal(out.extraPieces,'0');
  assert.deepEqual(out.actualSqft,{numerator:'0',denominator:'1'});
  assert.deepEqual(out.nominalSqft,{numerator:'0',denominator:'1'});
  assert.equal(out.displaySqft,'0.00');
  assert.equal(out.measurementSnapshot.revision,'1');
  assert.equal(out.postingAllowed,false);
});

test('OVERSOLD -5 Pcs is an explicit signed shortage, not five available Pcs',()=>{
  const out=view('-5');
  assert.equal(out.stockState,'oversold');
  assert.equal(out.basePcs,'-5');
  assert.equal(out.boxes,'0');
  assert.equal(out.extraPieces,'5');
  assert.deepEqual(out.actualSqft,{numerator:'-10',denominator:'3'});
  assert.equal(out.displaySqft,'-3.33');
  assert.equal(out.postingAllowed,false);
});

test('OVERSOLD -53 Pcs preserves magnitude split and signed precise Sqft',()=>{
  const out=view('-53');
  assert.equal(out.stockState,'oversold');
  assert.equal(out.boxes,'2');
  assert.equal(out.extraPieces,'3');
  assert.deepEqual(out.actualSqft,{numerator:'-106',denominator:'3'});
  assert.equal(out.displaySqft,'-35.33');
});

test('manufacturer carton coverage is distinct from nominal dimensions',()=>{
  const config=measurement({
    coveragePolicy:'manufacturer',manufacturerSqftPerBox:'16.668',
    manufacturerEvidence:'reviewed-synthetic-label'
  });
  const out=view('450',config);
  assert.equal(out.boxes,'18');
  assert.deepEqual(out.actualSqft,{numerator:'37503',denominator:'125'});
  assert.deepEqual(out.nominalSqft,{numerator:'300',denominator:'1'});
  assert.equal(out.displaySqft,'300.02');
  assert.equal(out.measurementSnapshot.manufacturerEvidence,'reviewed-synthetic-label');
});

test('the original exact measurement revision remains authoritative after catalogue changes',()=>{
  const old=view('53');
  const newRevision=measurement({revision:'2',piecesPerBox:'24',boxConversionId:'BOX-24',width:'12'});
  const newCatalog=catalog({unitConfig:{revision:2,stockUnitName:'Pcs',conversions:[
    {conversionId:'BOX-24',unitName:'Box',factorText:'24'}
  ]}});
  const current=view('53',newRevision,newCatalog);
  assert.equal(old.boxes,'2');
  assert.equal(old.extraPieces,'3');
  assert.equal(old.measurementSnapshot.revision,'1');
  assert.equal(current.boxes,'2');
  assert.equal(current.extraPieces,'5');
  assert.equal(current.packUnitName,'Box');
  assert.deepEqual(current.actualSqft,{numerator:'53',denominator:'1'});
  assert.throws(()=>view('53',measurement(),newCatalog),/catalog.*mismatch/i);
});

test('wrong product, revision, pack factor, inactive proof and duplicate conversion fail closed',()=>{
  const candidates=[
    catalog({productId:'WRONG'}),
    catalog({baseUnitName:'Sqft'}),
    catalog({unitConfig:{revision:2,stockUnitName:'Pcs',conversions:[
      {conversionId:'BOX-25',unitName:'Carton',factorText:'25'}
    ]}}),
    catalog({unitConfig:{revision:1,stockUnitName:'Pcs',conversions:[
      {conversionId:'BOX-25',unitName:'Carton',factorText:'24'}
    ]}}),
    catalog({unitConfig:{revision:1,stockUnitName:'Pcs',conversions:[
      {conversionId:'BOX-25',unitName:'Carton',factorText:'25'},
      {conversionId:'BOX-25',unitName:'Carton',factorText:'25'}
    ]}})
  ];
  for(const candidate of candidates)assert.throws(()=>view('5',measurement(),candidate),/catalog.*mismatch/i);
  assert.throws(()=>view('5',measurement({coveragePolicy:'manufacturer'})),/catalog.*mismatch/i);
});

test('invalid stock types, fractional Pcs, noncanonical signs and unsafe numbers reject',()=>{
  for(const stock of [
    53,0,null,undefined,'','-0','+5','05','-05','5.0','0.5','-0.5',
    ' 5','5 ','1e2','Infinity','NaN','9007199254740992','-9007199254740992'
  ]) assert.throws(()=>view(stock),/stock|Pcs|integer|safe|canonical/i);
});

test('valid max-safe stock stays integer-exact without float-based area input',()=>{
  const out=view('9007199254740991');
  assert.equal(out.basePcs,'9007199254740991');
  assert.equal(BigInt(out.boxes)*25n+BigInt(out.extraPieces),9007199254740991n);
  assert.equal(out.postingAllowed,false);
});

test('trusted input objects are not mutated; no stock, D1 or public route is exposed',()=>{
  const config=measurement(),source=catalog(),before=structuredClone({config,source});
  const out=view('53',config,source);
  assert.deepEqual({config,source},before);
  assert.equal(out.postingAllowed,false);
  const module=readFileSync(new URL('../src/modules/m05-tile-stock-view.js',import.meta.url),'utf8');
  const runtime=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.doesNotMatch(module,/D1Database|LockService|SpreadsheetApp|\.batch\s*\(|\.run\s*\(|\.put\s*\(/);
  assert.doesNotMatch(runtime,/m05-tile-stock-view|projectTileStockView/);
});
