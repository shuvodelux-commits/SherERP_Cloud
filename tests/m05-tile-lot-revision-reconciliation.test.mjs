import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditTileLotStock} from '../src/modules/m05-tile-lot-revision-reconciliation.js';

const productId='T-8X12';
const measurement=(patch={})=>({
  productId,revision:'1',baseUnit:'Pcs',boxConversionId:'BOX-25',
  length:'12',width:'8',dimensionUnit:'in',piecesPerBox:'25',
  coveragePolicy:'nominal',...patch
});
const catalog=(patch={})=>({
  productId,baseUnitName:'Pcs',unitConfig:{
    revision:1,stockUnitName:'Pcs',conversions:[{
      conversionId:'BOX-25',unitName:'Carton',factorText:'25'
    }]
  },...patch
});
const lot=(lotId,remainingPcs,options={})=>({
  lotId,productId,remainingPcs,status:'Active',
  catalog:catalog(),measurement:measurement(),...options
});
const audit=(cachedStockPcs,lots)=>
  auditTileLotStock({productId,cachedStockPcs,lots});
const codes=report=>report.issues.map(x=>x.code);

test('all original lots including negative OVERSOLD reconcile exact 53 - 11 = 42 Pcs and 28 Sqft',()=>{
  const report=audit('42',[lot('LOT-SUP-A','53'),
    lot('LOT-SUP-B','-11',{status:'Oversold'})]);
  assert.equal(report.mode,'read-only-tile-lot-audit');
  assert.equal(report.ready,true);
  assert.equal(report.status,'MATCH');
  assert.equal(report.lotStockPcs,'42');
  assert.equal(report.differencePcs,'0');
  assert.equal(report.areaState,'UNIFORM_MEASUREMENT');
  assert.deepEqual(report.aggregateSqft,{numerator:'28',denominator:'1'});
  assert.equal(report.lotViews[0].view.boxes,'2');
  assert.equal(report.lotViews[0].view.extraPieces,'3');
  assert.equal(report.lotViews[1].view.stockState,'oversold');
  assert.equal(report.lotViews[1].view.displaySqft,'-7.33');
  assert.equal(report.postingAllowed,false);
  assert.deepEqual(report.issues,[]);
});

test('historical 25 Pcs/Carton 8x12 and newer 24 Pcs/Box 12x12 are not area-netted',()=>{
  const historical=lot('L-OLD','25');
  const changed=lot('L-NEW','24',{
    measurement:measurement({revision:'2',boxConversionId:'BOX-24',
      piecesPerBox:'24',length:'12',width:'12'}),
    catalog:catalog({unitConfig:{revision:2,stockUnitName:'Pcs',conversions:[{
      conversionId:'BOX-24',unitName:'Box',factorText:'24'
    }]}})
  });
  const report=audit('49',[historical,changed]);
  assert.equal(report.ready,true);
  assert.equal(report.status,'MATCH');
  assert.equal(report.lotStockPcs,'49');
  assert.equal(report.areaState,'MIXED_MEASUREMENTS');
  assert.equal(report.aggregateSqft,null);
  assert.deepEqual(report.lotViews[0].view.actualSqft,{numerator:'50',denominator:'3'});
  assert.deepEqual(report.lotViews[1].view.actualSqft,{numerator:'24',denominator:'1'});
  assert.equal(report.lotViews[0].view.measurementSnapshot.revision,'1');
  assert.equal(report.lotViews[1].view.measurementSnapshot.revision,'2');
});

test('manufacturer-verified coverage remains historical and must not be replaced with nominal',()=>{
  const evidence=measurement({coveragePolicy:'manufacturer',
    manufacturerSqftPerBox:'16.668',
    manufacturerEvidence:'verified-label-2026'});
  const report=audit('450',[lot('L-MFR','450',{measurement:evidence})]);
  assert.equal(report.areaState,'UNIFORM_MEASUREMENT');
  assert.deepEqual(report.aggregateSqft,{numerator:'37503',denominator:'125'});
  assert.deepEqual(report.lotViews[0].view.nominalSqft,{numerator:'300',denominator:'1'});
  assert.equal(report.lotViews[0].view.measurementSnapshot.manufacturerEvidence,'verified-label-2026');
  assert.equal(report.ready,true);
});

test('different manufacturer evidence or coverage under same revision blocks aggregate area',()=>{
  const a=measurement({coveragePolicy:'manufacturer',
    manufacturerSqftPerBox:'16.668',manufacturerEvidence:'label-A'});
  const b=measurement({coveragePolicy:'manufacturer',
    manufacturerSqftPerBox:'16.670',manufacturerEvidence:'label-B'});
  const report=audit('50',[lot('L-A','25',{measurement:a}),
    lot('L-B','25',{measurement:b})]);
  assert.equal(report.ready,true);
  assert.equal(report.areaState,'MIXED_MEASUREMENTS');
  assert.equal(report.aggregateSqft,null);
  assert.notDeepEqual(report.lotViews[0].view.actualSqft,report.lotViews[1].view.actualSqft);
});

test('source reconciliation includes Deleted positive lots but blocks readiness',()=>{
  const report=audit('8',[lot('L-A','5'),lot('L-DELETED','3',{status:'Deleted'})]);
  assert.equal(report.lotStockPcs,'8');
  assert.equal(report.status,'MATCH');
  assert.equal(report.ready,false);
  assert.deepEqual(codes(report),['DELETED_POSITIVE_LOT']);
  assert.equal(report.lotViews.length,2);
});

test('source product cached stock drift is not silently fixed',()=>{
  const report=audit('50',[lot('L-A','53')]);
  assert.equal(report.ready,false);
  assert.equal(report.status,'MISMATCH');
  assert.equal(report.lotStockPcs,'53');
  assert.equal(report.differencePcs,'3');
  assert.deepEqual(codes(report),['STOCK_MISMATCH']);
});

test('missing source lots: zero is acknowledged; nonzero is quarantined',()=>{
  const zero=audit('0',[]);
  assert.equal(zero.ready,true);
  assert.equal(zero.status,'NO_LOTS_ZERO');
  assert.equal(zero.areaState,'NO_LOTS');
  assert.equal(zero.aggregateSqft,null);
  assert.deepEqual(zero.lotViews,[]);
  const missing=audit('-5',[]);
  assert.equal(missing.ready,false);
  assert.equal(missing.status,'NO_LOTS_NONZERO');
  assert.equal(missing.lotStockPcs,'0');
  assert.equal(missing.differencePcs,'5');
  assert.deepEqual(codes(missing),['NO_LOTS_NONZERO']);
});

test('duplicate Lot ID and wrong original product ID are rejected before aggregation',()=>{
  assert.throws(()=>audit('2',[lot('L1','1'),lot('L1','1')]),/duplicate.*lot/i);
  assert.throws(()=>audit('1',[lot('L1','1',{productId:'WRONG'})]),/product.*identity/i);
  assert.throws(()=>audit('1',[lot('','1')]),/lot.*identity/i);
});

test('stale or forged measurement/catalog identity cannot silently reinterpret old lots',()=>{
  const wrongCatalog=catalog({unitConfig:{revision:2,stockUnitName:'Pcs',conversions:[{
    conversionId:'BOX-25',unitName:'Carton',factorText:'25'
  }]}});
  assert.throws(()=>audit('1',[lot('L1','1',{catalog:wrongCatalog})]),/catalog.*mismatch/i);
  assert.throws(()=>audit('1',[lot('L1','1',{
    measurement:measurement({piecesPerBox:'24'})
  })]),/catalog.*mismatch/i);
  assert.throws(()=>audit('1',[lot('L1','1',{
    measurement:measurement({coveragePolicy:'manufacturer'})
  })]),/catalog.*mismatch/i);
});

test('no floating stock, unsafe Pcs or aggregate quantity overflow passes',()=>{
  for(const stock of ['0.1','-0','01','+1','NaN','9007199254740992',12,null]){
    assert.throws(()=>audit(stock,[lot('L1','1')]),/stock|integer|safe|canonical|Pcs/i);
    assert.throws(()=>audit('1',[lot('L1',stock)]),/stock|integer|safe|canonical|Pcs/i);
  }
  assert.throws(()=>audit('0',[lot('L1','9007199254740991'),
    lot('L2','1')]),/safe|overflow/i);
});

test('trusted records reject accessor properties, nonplain rows and missing list',()=>{
  assert.throws(()=>auditTileLotStock(null),/snapshot|record/i);
  assert.throws(()=>auditTileLotStock({productId,cachedStockPcs:'0',lots:null}),/lots|array/i);
  assert.throws(()=>audit('0',[new Date()]),/lot|record/i);
  const accessor=Object.defineProperty({},'lotId',{get(){throw new Error('accessor ran');}});
  assert.throws(()=>audit('0',[accessor]),/accessor|lot|record/i);
});

test('read-only audit does not mutate original records or bind to public worker or D1',()=>{
  const source=[lot('L-A','53'),lot('L-B','-11',{status:'Oversold'})];
  const input={productId,cachedStockPcs:'42',lots:source};
  const snapshot=structuredClone(input);
  const report=auditTileLotStock(input);
  assert.equal(report.ready,true);
  assert.deepEqual(input,snapshot);
  assert.equal(report.postingAllowed,false);
  assert.equal(report.lotViews.every(x=>x.view.postingAllowed===false),true);
  const module=readFileSync(new URL('../src/modules/m05-tile-lot-revision-reconciliation.js',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.doesNotMatch(module,/D1Database|SpreadsheetApp|LockService|\.batch\s*\(|\.run\s*\(|\.put\s*\(/);
  assert.doesNotMatch(worker,/m05-tile-lot-revision-reconciliation|auditTileLotStock/);
});
