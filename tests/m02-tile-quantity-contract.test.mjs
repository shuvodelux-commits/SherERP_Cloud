import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveTileQuantity, priceTileQuantity, resolveTileQuantityFromCatalog
} from '../src/modules/tile-quantity-contract.js';
import {resolveProductUnitBreakdown_} from '../src/modules/product-unit-conversions.js';

const tile = (patch={}) => ({
  productId:'T-8X12', revision:'1', baseUnit:'Pcs',
  boxConversionId:'BOX-25', length:'12', width:'8',
  dimensionUnit:'in', piecesPerBox:'25', coveragePolicy:'nominal',
  ...patch
});
const pack = (boxes='2', extraPieces='3') => ({mode:'pack',boxes,extraPieces});
const area = (requestedSqft, fulfillment='loose') => ({mode:'area',requestedSqft,fulfillment});

// Mutation targets: swapped dimension scale or hard-coded pack quantity.
for (const [length,width,perBox,want] of [
  ['8','12','25',{numerator:'50',denominator:'3'}],
  ['12','12','10',{numerator:'10',denominator:'1'}],
  ['12','24','6',{numerator:'12',denominator:'1'}],
  ['24','24','4',{numerator:'16',denominator:'1'}]
]) test(length+'x'+width+' keeps product-specific whole pieces and exact coverage',()=>{
  const out=resolveTileQuantity(tile({length,width,piecesPerBox:perBox}),pack('1','0'));
  assert.equal(out.pieces,perBox);
  assert.deepEqual(out.actualSqft,want);
});

test('2 Box plus 3 Pcs retains 53 pieces and exact 106/3 Sqft',()=>{
  const out=resolveTileQuantity(tile(),pack());
  assert.equal(out.pieces,'53');
  assert.equal(out.boxes,'2');
  assert.equal(out.extraPieces,'3');
  assert.deepEqual(out.actualSqft,{numerator:'106',denominator:'3'});
  assert.equal(out.displaySqft,'35.33');
  assert.equal(out.requestedSqft,null);
});

test('tile pack quantity uses the existing multi-unit physical quantity contract',()=>{
  const out=resolveTileQuantity(tile(),pack());
  const legacy=resolveProductUnitBreakdown_(
    {'Product ID':'T-8X12',Unit:'Pcs'},
    [{conversionId:'BOX-25',qty:2},{conversionId:'BASE',qty:3}],53,
    [{'Conversion ID':'BOX-25','Product ID':'T-8X12','Unit Name':'Box','Conversion Factor':25,Status:'Active'}]
  );
  assert.equal(String(legacy.baseQty),out.pieces);
  assert.deepEqual(out.unitSnapshot,legacy.snapshot);
});

test('35.50 requested Sqft rounds up to 54 whole Pcs and keeps both areas',()=>{
  const out=resolveTileQuantity(tile(),area('35.50'));
  assert.equal(out.pieces,'54');
  assert.equal(out.boxes,'2');
  assert.equal(out.extraPieces,'4');
  assert.deepEqual(out.requestedSqft,{numerator:'71',denominator:'2'});
  assert.deepEqual(out.actualSqft,{numerator:'36',denominator:'1'});
  assert.equal(out.displaySqft,'36.00');
});

test('box-only area fulfillment rounds to complete boxes',()=>{
  const out=resolveTileQuantity(tile(),area('35.50','box-only'));
  assert.equal(out.pieces,'75');
  assert.equal(out.boxes,'3');
  assert.equal(out.extraPieces,'0');
  assert.deepEqual(out.actualSqft,{numerator:'50',denominator:'1'});
});

test('exact decimal boundaries never deliver less area than requested',()=>{
  assert.equal(resolveTileQuantity(tile(),area('2')).pieces,'3');
  assert.equal(resolveTileQuantity(tile(),area('2.000000000001')).pieces,'4');
  assert.equal(resolveTileQuantity(tile(),area('1.999999999999')).pieces,'3');
});

test('extra pieces normalize deterministically into full boxes',()=>{
  const out=resolveTileQuantity(tile(),pack('1','28'));
  assert.equal(out.pieces,'53');
  assert.equal(out.boxes,'2');
  assert.equal(out.extraPieces,'3');
});

test('manufacturer policy is explicit, evidenced and distinct from nominal',()=>{
  const m=tile({coveragePolicy:'manufacturer',manufacturerSqftPerBox:'16.668',manufacturerEvidence:'verified-label:2026-11-17'});
  const out=resolveTileQuantity(m,pack('18','0'));
  assert.deepEqual(out.actualSqft,{numerator:'37503',denominator:'125'});
  assert.equal(out.displaySqft,'300.02');
  assert.deepEqual(out.nominalSqft,{numerator:'300',denominator:'1'});
  assert.equal(resolveTileQuantity(tile({...m,coveragePolicy:'nominal'}),pack('18','0')).displaySqft,'300.00');
  assert.throws(()=>resolveTileQuantity(tile({coveragePolicy:'manufacturer'}),pack()),/manufacturer/i);
  assert.throws(()=>resolveTileQuantity(tile({...m,manufacturerEvidence:''}),pack()),/evidence/i);
});

test('millimetres and centimetres use exact inch conversions',()=>{
  for(const config of [
    {length:'304.8',width:'203.2',dimensionUnit:'mm'},
    {length:'30.48',width:'20.32',dimensionUnit:'cm'}
  ]) assert.deepEqual(resolveTileQuantity(tile(config),pack()).actualSqft,{numerator:'106',denominator:'3'});
});

test('historical 25-piece snapshot survives a current 24-piece configuration',()=>{
  const old=resolveTileQuantity(tile(),pack());
  const stored=JSON.parse(JSON.stringify(old.measurementSnapshot));
  const current=resolveTileQuantity(tile({revision:'2',piecesPerBox:'24',boxConversionId:'BOX-24'}),pack());
  assert.equal(current.pieces,'51');
  assert.equal(resolveTileQuantity(stored,pack()).pieces,'53');
  assert.equal(resolveTileQuantity(stored,pack('0','3')).displaySqft,'2.00');
  assert.equal(stored.revision,'1');
});

test('no input mutation and no loss of immutable measurement evidence',()=>{
  const input=tile(),request=pack(),before=structuredClone({input,request});
  const out=resolveTileQuantity(input,request);
  input.piecesPerBox='24';
  assert.equal(out.measurementSnapshot.piecesPerBox,'25');
  assert.deepEqual(request,before.request);
  assert.deepEqual({...input,piecesPerBox:'25'},before.input);
});

test('reject negative, zero, fractional physical quantities and invalid packs',()=>{
  for(const request of [
    pack('-1','0'),pack('0','-1'),pack('0','0'),pack('0.5','0'),
    pack('1','0.1'),area('0'),area('-1'),area('Infinity'),area('NaN'),
    area('1e3'),area(' 2'),area('2','unknown')
  ]) assert.throws(()=>resolveTileQuantity(tile(),request));
  for(const config of [
    {piecesPerBox:'0'},{piecesPerBox:'2.5'},{length:'0'},{width:'-1'},
    {length:'1e2'},{dimensionUnit:'feet'},{baseUnit:'Sqft'},
    {revision:''},{revision:'0'},{productId:''},{boxConversionId:'BASE'},
    {coveragePolicy:'automatic'},{length:12},{piecesPerBox:25},
    {manufacturerSqftPerBox:'0',coveragePolicy:'manufacturer',manufacturerEvidence:'verified'}
  ]) assert.throws(()=>resolveTileQuantity(tile(config),pack()));
});

test('bounded exact decimal inputs reject unsafe or ambiguous representations',()=>{
  for(const value of ['01','+1','.5','1.','1.0000000000001','9'.repeat(40),true,null])
    assert.throws(()=>resolveTileQuantity(tile(),area(value)));
  assert.throws(()=>resolveTileQuantity(tile(),{...pack(),requestedSqft:'9'}));
  assert.throws(()=>resolveTileQuantity(tile(),{...area('9'),boxes:'1'}));
});

test('large safe integer quantity remains exact; unsafe legacy bridge is refused',()=>{
  const out=resolveTileQuantity(tile(),pack('100000000000','3'));
  assert.equal(out.pieces,'2500000000003');
  assert.deepEqual(out.actualSqft,{numerator:'5000000000006',denominator:'3'});
  assert.throws(()=>resolveTileQuantity(tile(),pack('9007199254740991','0')),/safe|large/i);
});

test('Sqft pricing uses exact area before one half-up minor-unit rounding',()=>{
  const priced=priceTileQuantity(tile(),pack(),'Sqft','38.00');
  assert.equal(priced.lineAmountMinor,'134267');
  assert.deepEqual(priced.exactAmount,{numerator:'4028',denominator:'3'});
  assert.equal(priced.billingQuantityDisplay,'35.33');
  assert.equal(priced.displayQuantityAmountMinor,'134254');
  assert.equal(priced.displayQuantityAmountDeltaMinor,'13');
});

test('Box and Pcs billing use the same physical quantity with exact prices',()=>{
  assert.equal(priceTileQuantity(tile(),pack(),'Box','100').lineAmountMinor,'21200');
  assert.equal(priceTileQuantity(tile(),pack(),'Pcs','4.375').lineAmountMinor,'23188');
  assert.equal(priceTileQuantity(tile(),pack('0','1'),'Pcs','0.005').lineAmountMinor,'1');
  assert.equal(priceTileQuantity(tile(),pack('0','1'),'Pcs','0').lineAmountMinor,'0');
});

test('selected trusted price overrides change money without changing stock quantity',()=>{
  const a=priceTileQuantity(tile(),pack(),'Sqft','38');
  const b=priceTileQuantity(tile(),pack(),'Sqft','40');
  assert.equal(a.quantity.pieces,b.quantity.pieces);
  assert.equal(b.lineAmountMinor,'141333');
  assert.equal(b.priceSnapshot.unitPriceText,'40');
});

test('invoice line arithmetic exposes the manufacturer display difference',()=>{
  const m=tile({coveragePolicy:'manufacturer',manufacturerSqftPerBox:'16.668',manufacturerEvidence:'label:verified'});
  const out=priceTileQuantity(m,pack('18','0'),'Sqft','38');
  assert.equal(out.quantity.displaySqft,'300.02');
  assert.equal(out.lineAmountMinor,'1140091');
  assert.equal(out.displayQuantityAmountMinor,'1140076');
  assert.equal(out.displayQuantityAmountDeltaMinor,'15');
  const second=priceTileQuantity(m,pack('6','0'),'Sqft','38');
  assert.equal(second.lineAmountMinor,'380030');
  assert.equal(BigInt(out.lineAmountMinor)*2n+BigInt(second.lineAmountMinor),2660212n);
});

test('reject unsupported billing units, negative prices and unsafe money inputs',()=>{
  for(const unit of ['sqft','Unknown','Carton',null])
    assert.throws(()=>priceTileQuantity(tile(),pack(),unit,'38'));
  for(const price of ['-1','NaN','1e3',Infinity,38,'0.0000000000001'])
    assert.throws(()=>priceTileQuantity(tile(),pack(),'Sqft',price));
});

test('existing single-unit source behavior remains independent of tiles',()=>{
  assert.deepEqual(resolveProductUnitBreakdown_(
    {'Product ID':'LEGACY',Unit:'Feet'},[],7,[]
  ),{baseQty:7,snapshot:[],components:[],hasBreakdown:false});
});

test('dimension units cannot be coerced from an array or object',()=>{
  for(const dimensionUnit of [['in'],{toString:()=> 'in'}])
    assert.throws(()=>resolveTileQuantity(tile({dimensionUnit}),pack()),/dimension unit/i);
});

test('pricing generated large coverage does not reparse it as an input decimal',()=>{
  const out=priceTileQuantity(tile({
    length:'100000000000000000000000',width:'100000000000000000000000'
  }),pack('0','1'),'Sqft','0');
  assert.equal(out.lineAmountMinor,'0');
  assert.equal(out.displayQuantityAmountMinor,'0');
  assert.equal(out.quantity.pieces,'1');
});

const catalog=()=>({
  productId:'T-8X12',baseUnitName:'Pcs',
  unitConfig:{revision:1,stockUnitName:'Pcs',conversions:[{
    conversionId:'BOX-25',unitName:'Carton',factorText:'25.000'
  }]}
});

test('catalog-bound tiles preserve verified pack label and exact integral factor',()=>{
  const out=resolveTileQuantityFromCatalog(catalog(),tile(),pack());
  assert.equal(out.pieces,'53');
  assert.equal(out.unitSnapshot[0].unitName,'Carton');
  assert.equal(out.measurementSnapshot.boxUnitName,'Carton');
  assert.equal(resolveTileQuantity(out.measurementSnapshot,pack()).pieces,'53');
});

test('catalog-bound tiles reject product, stock unit, revision and pack mismatches',()=>{
  const wrongProduct={...catalog(),productId:'OTHER'};
  const wrongStock={...catalog(),baseUnitName:'Sqft'};
  const wrongRevision=catalog();wrongRevision.unitConfig.revision=2;
  const wrongPack=catalog();wrongPack.unitConfig.conversions[0].factorText='25.000000000001';
  const missingPack=catalog();missingPack.unitConfig.conversions=[];
  const duplicatePack=catalog();duplicatePack.unitConfig.conversions.push({...duplicatePack.unitConfig.conversions[0]});
  for(const candidate of [wrongProduct,wrongStock,wrongRevision,wrongPack,missingPack,duplicatePack])
    assert.throws(()=>resolveTileQuantityFromCatalog(candidate,tile(),pack()),/catalog/i);
  assert.throws(()=>resolveTileQuantityFromCatalog(catalog(),tile({boxUnitName:'Box'}),pack()),/catalog/i);
});
