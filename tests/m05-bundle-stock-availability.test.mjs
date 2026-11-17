import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import vm from 'node:vm';
import {reviewBundleStockAvailability} from '../src/modules/m05-bundle-stock-availability.js';

const frozenPath=new URL('../legacy/source/Bundles.gs',import.meta.url);
const portPath=new URL('../src/modules/m05-bundle-stock-availability.js',import.meta.url);
const names=['bundleProductType_','bundleProductMap_','validateBundleDefinition_',
  'getBundleDefinitions_','getBundleAvailability_'];

function functionBodies(source){
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
  const matching=ast.body.filter(x=>x.type==='FunctionDeclaration'&&names.includes(x.id.name));
  assert.equal(matching.length,names.length,'all original bundle helper declarations present');
  return Object.fromEntries(matching.map(n=>[n.id.name,source.slice(n.start,n.end)]));
}
const frozen=functionBodies(readFileSync(frozenPath,'utf8'));
const original=vm.createContext({});
vm.runInContext(Object.values(frozen).join('\n'),original);

const products=()=>[
  {'Product ID':'BUNDLE-001','Product Name':'Electrical Starter Kit',
    'Product Type':'Bundle','Bundle Revision':2,Status:'Active','Is Deleted':'FALSE',
    Unit:'set','Current Stock':0,'Selling Price':350,'Purchase Price':0},
  {'Product ID':'PRD-CABLE','Product Name':'Cable','Product Type':'Standard',
    Status:'Active','Is Deleted':'FALSE',Unit:'Pcs','Current Stock':9,
    'Selling Price':40,'Purchase Price':25},
  {'Product ID':'PRD-PIPE','Product Name':'Pipe','Product Type':'Standard',
    Status:'Active','Is Deleted':'FALSE',Unit:'Feet','Current Stock':18,
    'Selling Price':10,'Purchase Price':5},
  {'Product ID':'PRD-SWITCH','Product Name':'Switch','Product Type':'Standard',
    Status:'Active','Is Deleted':'FALSE',Unit:'Pcs','Current Stock':5,
    'Selling Price':12,'Purchase Price':8}
];
const rows=()=>[
  {'Bundle Product ID':'BUNDLE-001','Component Product ID':'PRD-CABLE',
    'Quantity Per Set':1,Unit:'Pcs',Revision:1,Status:'Active'},
  {'Bundle Product ID':'BUNDLE-001','Component Product ID':'PRD-CABLE',
    'Quantity Per Set':2,Unit:'Pcs',Revision:2,Status:'Active'},
  {'Bundle Product ID':'BUNDLE-001','Component Product ID':'PRD-PIPE',
    'Quantity Per Set':5,Unit:'Feet',Revision:2,Status:'Active'},
  {'Bundle Product ID':'BUNDLE-001','Component Product ID':'PRD-SWITCH',
    'Quantity Per Set':1,Unit:'Pcs',Revision:2,Status:'Active'}
];
const run=(patch={})=>reviewBundleStockAvailability({
  bundleId:'BUNDLE-001',products:products(),componentRows:rows(),...patch
});

test('frozen Bundles.gs helper functions remain byte-for-byte source-faithful',()=>{
  const copy=functionBodies(readFileSync(portPath,'utf8'));
  for(const name of names)assert.equal(copy[name],frozen[name],name+' source body drift');
});

test('three-component active revision-2 recipe has min(4,3,5)=3 complete kits and independent own selling price',()=>{
  const p=products(),r=rows(),before=structuredClone({p,r});
  const v=run({products:p,componentRows:r});
  assert.equal(v.mode,'read-only-bundle-availability');
  assert.equal(v.bundleId,'BUNDLE-001');
  assert.equal(v.revision,2);
  assert.equal(v.availableSets,3);
  assert.equal(v.bundleSellingPrice,350);
  assert.deepEqual(v.components.map(x=>[x.productId,x.qtyPerSet,x.currentStock,x.setsSupported]),[
    ['PRD-CABLE',2,9,4],['PRD-PIPE',5,18,3],['PRD-SWITCH',1,5,5]
  ]);
  assert.deepEqual(v.components.map(x=>x.unit),['Pcs','Feet','Pcs']);
  assert.equal(v.stockAuthority,'snapshot-only');
  assert.equal(v.bundlePhysicalStock,false);
  assert.equal(v.postingAllowed,false);
  assert.deepEqual({p,r},before);
});

test('the original source helper calculates identical current revision and availability from the same source rows',()=>{
  const p=products(),componentRows=rows();
  const map=original.bundleProductMap_(p);
  const d=original.getBundleDefinitions_(['BUNDLE-001'],map,componentRows)['BUNDLE-001'];
  const v=run({products:p,componentRows});
  assert.equal(v.revision,d.revision);
  assert.deepEqual(v.components.map(x=>[x.productId,x.qtyPerSet,x.unit]),
    JSON.parse(JSON.stringify(d.components)).map(x=>[x.productId,x.qtyPerSet,x.unit]));
  assert.equal(v.availableSets,original.getBundleAvailability_(d,map));
});

test('old revision and inactive recipe rows cannot change the availability of the active version',()=>{
  const r=rows();
  r.push({'Bundle Product ID':'BUNDLE-001','Component Product ID':'PRD-PIPE',
    'Quantity Per Set':100,Unit:'Feet',Revision:1,Status:'Active'});
  r.push({'Bundle Product ID':'BUNDLE-001','Component Product ID':'PRD-SWITCH',
    'Quantity Per Set':100,Unit:'Pcs',Revision:2,Status:'Inactive'});
  assert.equal(run({componentRows:r}).availableSets,3);
  const stale=r.filter(x=>x.Revision!==2);
  assert.throws(()=>run({componentRows:stale}),/recipe unavailable/i);
});

test('source fractional standard-unit component can support integer whole bundle sets',()=>{
  const r=rows().map(x=>x['Component Product ID']==='PRD-PIPE'&&x.Revision===2
    ? {...x,'Quantity Per Set':0.5}:x);
  const p=products().map(x=>x['Product ID']==='PRD-PIPE'
    ? {...x,'Current Stock':2.75}:x);
  const result=run({products:p,componentRows:r});
  assert.equal(result.components[1].qtyPerSet,0.5);
  assert.equal(result.components[1].setsSupported,5);
  assert.equal(result.availableSets,4);
});

test('negative OVERSOLD stock can never make a bundle available or become a physical Bundle lot',()=>{
  const p=products().map(x=>x['Product ID']==='PRD-PIPE'
    ? {...x,'Current Stock':-20}:x);
  const result=run({products:p});
  assert.equal(result.availableSets,0);
  assert.equal(result.components[1].currentStock,-20);
  assert.equal(result.components[1].setsSupported,0);
  assert.equal(result.bundlePhysicalStock,false);
});

test('bundle selling price is independent of all component prices and their FIFO costs',()=>{
  const p=products().map(x=>x['Product Type']==='Standard'
    ? {...x,'Selling Price':999999,'Purchase Price':888888}:x);
  const v=run({products:p});
  assert.equal(v.bundleSellingPrice,350);
  assert.equal(v.availableSets,3);
  const newPrice=products().map(x=>x['Product ID']==='BUNDLE-001'
    ? {...x,'Selling Price':450}:x);
  assert.equal(run({products:newPrice}).bundleSellingPrice,450);
});

test('nested Bundle, inactive, deleted or absent component product never produces a sellable kit',()=>{
  const p=products();
  for(const change of [
    {'Product Type':'Bundle'}, {Status:'Inactive'}, {'Is Deleted':'TRUE'}
  ]){
    const altered=p.map(x=>x['Product ID']==='PRD-CABLE'?{...x,...change}:x);
    assert.throws(()=>run({products:altered}),/component|standard|active/i);
  }
  const missing=p.filter(x=>x['Product ID']!=='PRD-PIPE');
  assert.throws(()=>run({products:missing}),/component.*not found/i);
});

test('duplicated active component and bad source quantity fail closed',()=>{
  const r=rows();
  assert.throws(()=>run({componentRows:[...r,{...r[1]}]}),/component appears more than once/i);
  for(const invalid of [0,-1,Infinity,NaN,1000000001]){
    const altered=r.map(x=>x['Component Product ID']==='PRD-PIPE'&&x.Revision===2
      ? {...x,'Quantity Per Set':invalid}:x);
    assert.throws(()=>run({componentRows:altered}),/quantity|finite|maximum/i);
  }
});

test('inactive, deleted, wrong-type or missing current Bundle definition rejects instead of falling back to revision 1',()=>{
  const p=products();
  for(const change of [{Status:'Inactive'},{'Is Deleted':'TRUE'},{'Product Type':'Standard'}]){
    const altered=p.map(x=>x['Product ID']==='BUNDLE-001'?{...x,...change}:x);
    assert.throws(()=>run({products:altered}),/bundle.*active|bundle.*product/i);
  }
  assert.throws(()=>run({products:p.filter(x=>x['Product ID']!=='BUNDLE-001')}),/bundle.*not found/i);
  assert.throws(()=>run({products:p.map(x=>x['Product ID']==='BUNDLE-001'
    ? {...x,'Bundle Revision':3}:x)}),/recipe unavailable/i);
});

test('duplicate products and reserved/prototype-colliding Product IDs fail before any source lookup',()=>{
  assert.throws(()=>run({products:[...products(),{...products()[1]}]}),/duplicate.*product/i);
  assert.throws(()=>run({bundleId:'__proto__'}),/identity|reserved/i);
  assert.throws(()=>run({bundleId:'constructor'}),/identity|reserved/i);
  assert.throws(()=>run({bundleId:''}),/identity|product/i);
});

test('malformed, accessor-bearing, sparse and nonfinite snapshots fail closed',()=>{
  for(const bad of [null,{},new Array(1),[null],[]]){
    assert.throws(()=>run({products:bad}),/product|array|snapshot|record/i);
  }
  const getter=Object.defineProperty({},'Product ID',{get(){throw Error('forbidden getter');}});
  assert.throws(()=>run({products:[getter,...products()]}),/accessor|product|record/i);
  for(const value of [NaN,Infinity,'n/a',true,null]){
    const p=products().map(x=>x['Product ID']==='PRD-PIPE'
      ? {...x,'Current Stock':value}:x);
    assert.throws(()=>run({products:p}),/stock|finite|number/i);
  }
  const row=Object.defineProperty({},'Component Product ID',{get(){throw Error('forbidden component getter');}});
  assert.throws(()=>run({componentRows:[row]}),/accessor|component|record/i);
});

test('malformed or unsafe Bundle revisions and selling prices reject without deriving new source IDs',()=>{
  const p=products();
  for(const rev of [0,-1,Infinity,NaN,'2',9007199254740992]){
    assert.throws(()=>run({products:p.map(x=>x['Product ID']==='BUNDLE-001'
      ? {...x,'Bundle Revision':rev}:x)}),/revision|integer/i);
  }
  for(const price of [-1,Infinity,NaN,'350',null]){
    assert.throws(()=>run({products:p.map(x=>x['Product ID']==='BUNDLE-001'
      ? {...x,'Selling Price':price}:x)}),/selling price|price|finite/i);
  }
});

test('virtual Bundle is not a purchase stock row and preview has no Worker RPC, SQL writes or stock mutation',()=>{
  const candidate=run();
  assert.equal(candidate.postingAllowed,false);
  assert.equal(candidate.bundlePhysicalStock,false);
  assert.equal('stockLotId' in candidate,false);
  assert.equal('movementId' in candidate,false);
  assert.equal('purchaseId' in candidate,false);
  const purchase=readFileSync(new URL('../src/modules/purchase-preflight.js',import.meta.url),'utf8');
  assert.match(purchase,/Virtual bundle sets cannot be purchased as physical stock/);
  const runtime=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  assert.doesNotMatch(runtime,/reviewBundleStockAvailability|m05-bundle-stock-availability/);
  const code=readFileSync(portPath,'utf8');
  assert.doesNotMatch(code,/\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b|\.batch\s*\(|\.run\s*\(/iu);
});
