import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {attachM05ProductStockMetadata} from '../src/modules/m05-products-ui-metadata-read.js';
import {formatM05ProductStockCell} from '../src/modules/m05-product-form-stock-preview.js';

const source=()=>({
 products:[
  {'Product ID':'P-CABLE','Product Name':'Cable','Product Type':'Standard',
   Unit:'Pcs','Current Stock':45,'Stock Value':225,'Selling Price':8,'Status':'Active'},
  {'Product ID':'T-24','Product Name':'Tile 24x24','Product Type':'Standard',
   Unit:'Pcs','Current Stock':128,'Stock Value':6400,'Selling Price':45,'Status':'Active'},
  {'Product ID':'P-CARTON','Product Name':'Carton tile','Product Type':'Standard',
   Unit:'Pcs','Current Stock':628,'Stock Value':8000,'Status':'Active'},
  {'Product ID':'B-SET','Product Name':'Bundle','Product Type':'Bundle',
   Unit:'Set','Current Stock':0,'Available Sets':3,'Stock Value':0,'Status':'Active'},
  {'Product ID':'P-PLAIN','Product Name':'Plain','Product Type':'Standard',
   Unit:'Feet','Current Stock':12,'Stock Value':42,'Status':'Active'}
 ],
 categories:[{id:'C-1',name:'Electrical'}],
 units:[{id:'U-PCS',name:'Pcs'},{id:'U-BOX',name:'Box'},
  {id:'U-CARTON',name:'Carton'},{id:'U-FEET',name:'Feet'}],
 currencySymbol:'৳',lowStockThreshold:5
});
const box=()=>({
 productId:'P-CABLE',
 unitRevision:'2',currentUnitRevision:'2',
 unitRelations:[{leftQty:1,leftUnit:'Box',rightQty:20,rightUnit:'Pcs'}]
});
const tile=()=>({
 productId:'T-24',
 unitRevision:'3',currentUnitRevision:'3',currentTileRevision:'5',
 unitRelations:[{leftQty:1,leftUnit:'Box',rightQty:25,rightUnit:'Pcs'}],
 tileMeasurement:{
  productId:'T-24',revision:'5',baseUnit:'Pcs',boxConversionId:'BOX-25',
  boxUnitName:'Box',length:'24',width:'24',dimensionUnit:'in',
  piecesPerBox:'25',coveragePolicy:'nominal'
 }
});
const carton=()=>({
 productId:'P-CARTON',
 unitRevision:'2',currentUnitRevision:'2',currentTileRevision:'1',
 unitRelations:[
  {leftQty:1,leftUnit:'Carton',rightQty:10,rightUnit:'Box'},
  {leftQty:1,leftUnit:'Box',rightQty:25,rightUnit:'Pcs'}
 ],
 tileMeasurement:{...tile().tileMeasurement,productId:'P-CARTON',revision:'1'}
});
const call=(configs=[box()],bootstrap=source())=>
 attachM05ProductStockMetadata({bootstrap,configs});
const display=row=>formatM05ProductStockCell({
 ...row['M05 Stock Preview'],baseStockText:String(row['Current Stock'])
}).stockCellText;

test('trusted Box/Pcs source metadata renders 45 Pcs as 2 Box 5 Pcs without mutating valuation',()=>{
 const input=source(),configs=[box()],before=structuredClone({input,configs});
 const out=call(configs,input);
 assert.equal(out.products[0]['Current Stock'],45);
 assert.equal(out.products[0]['Stock Value'],225);
 assert.equal(display(out.products[0]),'2 Box 5 Pcs');
 assert.equal(out.products[0]['M05 Stock Preview'].productId,'P-CABLE');
 assert.deepEqual(out.products[0]['M05 Stock Preview'].unitMasters.map(u=>u['Unit Name']),
  ['Pcs','Box','Carton','Feet']);
 assert.equal(out.postingAllowed,false);
 assert.deepEqual({input,configs},before);
});

test('Tile current manufacturer-or-nominal evidence passes exact 128 Pcs = 512.00 Sqft',()=>{
 const out=call([tile()]);
 const row=out.products[1];
 assert.equal(display(row),'5 Box 3 Pcs · 512.00 Sqft');
 assert.equal(row['Current Stock'],128);
 assert.equal(row['M05 Stock Preview'].tileMeasurement.revision,'5');
 assert.equal(out.products[0]['M05 Stock Preview'],undefined);
});

test('Carton Box Pcs active current Tile provides exact 628 Pcs = 2512.00 Sqft',()=>{
 const out=call([carton()]);
 assert.equal(display(out.products[2]),'2 Carton 5 Box 3 Pcs · 2512.00 Sqft');
});

test('signed OVERSOLD source quantity yields shortage and never an available stock position',()=>{
 const s=source();s.products[0]['Current Stock']=-45;
 const out=call([box()],s),row=out.products[0];
 const value=formatM05ProductStockCell({
  ...row['M05 Stock Preview'],baseStockText:String(row['Current Stock'])
 });
 assert.equal(value.stockState,'oversold');
 assert.equal(value.stockCellText,'Shortage: 2 Box 5 Pcs');
 assert.equal(value.postingAllowed,false);
});

test('unknown Standard/Bundle product and no-config bootstrap preserve exact source fields',()=>{
 const s=source();
 const out=call([],s);
 assert.deepEqual(out.products,s.products);
 assert.deepEqual(out.categories,s.categories);
 assert.deepEqual(out.units,s.units);
 assert.equal(out.currencySymbol,'৳');
 assert.equal(out.lowStockThreshold,5);
 assert.equal(out.postingAllowed,false);
 assert.equal('M05 Stock Preview' in out.products[3],false);
});

test('configuration cannot invent an unknown Product ID or a physical Bundle stock',()=>{
 assert.throws(()=>call([{...box(),productId:'NOT-IN-TENANT'}]),/unknown.*product|not found|source product/i);
 assert.throws(()=>call([{...box(),productId:'B-SET'}]),/bundle|standard/i);
 assert.throws(()=>call([{...box(),productId:'__proto__'}]),/identity|reserved/i);
});

test('duplicate Product IDs, config IDs, unit names and unexpected existing metadata reject',()=>{
 const s=source();s.products.push({...s.products[0]});
 assert.throws(()=>call([box()],s),/duplicate.*product/i);
 assert.throws(()=>call([box(),box()]),/duplicate.*config/i);
 const d=source();d.units.push({id:'U-BOX-2',name:'box'});
 assert.throws(()=>call([box()],d),/duplicate.*unit/i);
 const m=source();m.products[0]['M05 Stock Preview']={};
 assert.throws(()=>call([box()],m),/existing.*metadata|already.*metadata/i);
});

test('source unit must match the canonical base stock unit; inactive or missing source units cannot be inferred',()=>{
 const s=source();s.products[0].Unit='Feet';
 assert.throws(()=>call([box()],s),/unit.*mismatch|base unit/i);
 const absent=source();absent.units=absent.units.filter(u=>u.name!=='Box');
 assert.throws(()=>call([box()],absent),/unit.*active|not.*unit|unit/i);
});

test('stale missing or ambiguous unit revision rejects without fallback to older chain',()=>{
 for(const c of [{...box(),unitRevision:'1'},
  {...box(),unitRevision:'0'},
  {...box(),currentUnitRevision:'02'},
  {...box(),unitRevision:2},
  {...box(),currentUnitRevision:undefined}]){
  assert.throws(()=>call([c]),/revision|invalid/i);
 }
});

test('stale Tile measurement revision, mismatched pack and missing coverage evidence reject',()=>{
 assert.throws(()=>call([{...tile(),currentTileRevision:'6'}]),/revision|stale/i);
 assert.throws(()=>call([{...tile(),tileMeasurement:{...tile().tileMeasurement,piecesPerBox:'24'}}]),/pack.*mismatch/i);
 const m=tile();
 m.tileMeasurement={...m.tileMeasurement,coveragePolicy:'manufacturer'};
 assert.throws(()=>call([m]),/manufacturer|evidence/i);
});

test('malformed signed stock quantity and unsafe malformed source rows reject early',()=>{
 for(const value of ['1.5',1.5,NaN,Infinity,'1e2',9007199254740992]){
  const s=source();s.products[0]['Current Stock']=value;
  assert.throws(()=>call([box()],s),/stock|integer|canonical|safe/i);
 }
 const s=source();
 const row=Object.defineProperty({},'Product ID',{get(){throw Error('getter invoked');}});
 s.products[0]=row;
 assert.throws(()=>call([box()],s),/accessor|source|row|record/i);
});

test('malformed config and unit relationship getters never execute',()=>{
 const bad=Object.defineProperty({},'productId',{get(){throw Error('unsafe getter');}});
 assert.throws(()=>call([bad]),/accessor|record|config/i);
 const conf=box();
 conf.unitRelations=[Object.defineProperty({},'leftUnit',{get(){throw Error('unsafe getter');}})];
 assert.throws(()=>call([conf]),/accessor|record|unit/i);
 assert.throws(()=>attachM05ProductStockMetadata({
  bootstrap:source(),configs:[{...box(),postingAllowed:true}]
 }),/unsupported|field|unexpected/i);
});

test('emitted metadata arrays are clones, not mutating caller configuration or source unit rows',()=>{
 const conf=box(),s=source(),out=call([conf],s);
 const meta=out.products[0]['M05 Stock Preview'];
 assert.notEqual(meta.unitRelations,conf.unitRelations);
 assert.notEqual(meta.unitRelations[0],conf.unitRelations[0]);
 assert.notEqual(meta.unitMasters[0],s.units[0]);
 meta.unitRelations[0].rightQty=123;
 assert.equal(conf.unitRelations[0].rightQty,20);
 assert.equal(s.units[0].name,'Pcs');
});

test('no public RPC or live D1 writer introduced for stock display enrichment',()=>{
 const src=readFileSync(new URL('../src/modules/m05-products-ui-metadata-read.js',import.meta.url),'utf8');
 assert.doesNotMatch(src,/INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+\w+\s+SET|\.batch\s*\(|\.run\s*\(/i);
 const publicRpc=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8')+
 readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
 assert.doesNotMatch(publicRpc,/attachM05ProductStockMetadata/);
});
