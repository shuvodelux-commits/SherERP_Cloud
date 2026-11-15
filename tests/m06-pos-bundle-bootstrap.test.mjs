import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import {sourceBundleBootstrap} from './fixtures/m06-pos-bundle-bootstrap-oracle.mjs';
import {projectPosBootstrapWithBundles} from '../src/modules/pos-bootstrap-with-bundles.js';

const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(){
  const product=(id,type,price,stock,other={})=>({
    'Product ID':id,'Product Name':id,Brand:'',Unit:'pcs',
    Barcode:'',Category:'Hardware','Product Type':type,'Selling Price':price,
    'Purchase Price':type==='Bundle'?0:7,'Current Stock':stock,
    Status:'Active','Is Deleted':'FALSE',...other
  });
  const component=(bundle,revision,id,qty,other={})=>({
    'Bundle Product ID':bundle,Revision:revision,'Component Product ID':id,
    'Quantity Per Set':qty,Unit:'pcs',Status:'Active',...other
  });
  return {
    productRows:[
      product('SET-A','Bundle',85,0,{'Bundle Revision':2}),
      product('PIPE','Standard',20,5,{Unit:'Feet','Purchase Price':8}),
      product('SET-B','Bundle',31,0,{'Bundle Revision':1}),
      product('WIRE','Standard',15,2,{Unit:'Roll','Purchase Price':4}),
      product('SET-BAD','Bundle',70,0,{'Bundle Revision':1})
    ],
    bundleComponentRows:[
      component('SET-A',1,'PIPE',99), // stale revision ignored
      component('SET-A',2,'PIPE',2),
      component('SET-A',2,'WIRE',1),
      component('SET-B',1,'PIPE',1),
      component('SET-BAD',1,'MISSING',1)
    ],
    customerRows:[
      {'Customer ID':'CUS-1','Customer Name':'A','Phone':'01710000000',
       'Address':'A','Father Name':'First','Relation Type':'Father',
       'Current Due':25,'Is Deleted':'FALSE'},
      {'Customer ID':'CUS-2','Customer Name':'B','Phone':'01710000000',
       'Address':'B','Father Name':'Second','Relation Type':'Husband',
       'Current Due':-7,'Is Deleted':'FALSE'}
    ],
    stockLots:[
      {'Product ID':'PIPE','Lot ID':'LOT-02','Purchase Date':'2026-11-12',
       'Remaining Quantity':3,'Sell Price':22,Status:'Active'},
      {'Product ID':'PIPE','Lot ID':'LOT-01','Purchase Date':'2026-11-10',
       'Remaining Quantity':2,'Sell Price':18,Status:'Active'}
    ],
    vendors:[{id:'VEND-1'}],
    vendorsAll:[{id:'VEND-1'},{id:'VEND-2'}],
    bankAccounts:[{id:'BANK-1'}],
    sessionResult:{success:true,data:{id:'SESSION-1',status:'Open'}},
    actorPermissions:{posView:true,posCostView:false,reportsView:false},
    settings:{
      'Shop Name':'Store One','Currency Symbol':'৳','Tax Percent':'0',
      'POS Multi Payment Enabled':'true','POS Show Purchase Price':false
    }
  };
}
function parity(snapshot){
  const prior=clone(snapshot);
  const source=sourceBundleBootstrap(clone(snapshot));
  assert.equal(source.success,true,JSON.stringify(source));
  const output=projectPosBootstrapWithBundles(snapshot);
  assert.deepEqual(clone(output),source.data);
  assert.deepEqual(snapshot,prior,'bundle bootstrap must not modify product, recipe or stock snapshots');
  return output;
}

test('four production Bundle helper declarations are byte-for-byte pinned source',async()=>{
  const names=['bundleProductType_','validateBundleDefinition_',
    'getBundleDefinitions_','getBundleAvailability_'];
  function declarations(text){
    const parsed=parse(text,{ecmaVersion:'latest',sourceType:'module'}).body;
    const found=parsed.filter(node=>node.type==='FunctionDeclaration'&&names.includes(node.id.name));
    assert.equal(found.length,names.length);
    return Object.fromEntries(found.map(node=>[node.id.name,text.slice(node.start,node.end)]));
  }
  const legacy=declarations(readFileSync(new URL('../legacy/source/Bundles.gs',import.meta.url),'utf8'));
  const port=declarations(readFileSync(new URL('../src/modules/pos-bundle-catalog.js',import.meta.url),'utf8'));
  assert.deepEqual(port,legacy);
});

test('mixed Standard/Bundle POS product order matches original, while broken bundle is hidden',()=>{
  const result=parity(fixture());
  assert.deepEqual(result.products.map(p=>p.id),['SET-A','PIPE','SET-B','WIRE']);
  assert.equal(result.products[0].stock,2);
  assert.equal(result.products[2].stock,5);
  assert.equal(result.products[0].productType,'Bundle');
  assert.equal(result.products[0].bundleRevision,2);
  assert.deepEqual(result.products[0].lotPricing,[]);
  assert.equal(result.products[0].sellingPrice,85);
  assert.equal(result.products[0].autoSellingPrice,85);
  assert.equal(result.products[0].fallbackSellPrice,85);
  assert.deepEqual(result.products[1].lotPricing,[
    {qty:2,sellPrice:18},{qty:3,sellPrice:22}
  ]);
});

test('two bundles share a component without incorrectly reserving it during display',()=>{
  const result=parity(fixture());
  assert.equal(result.products.find(p=>p.id==='SET-A').stock,2);
  assert.equal(result.products.find(p=>p.id==='SET-B').stock,5);
  assert.equal(result.products.find(p=>p.id==='PIPE').stock,5);
});

test('current product bundle revision is authoritative; stale recipe rows are ignored',()=>{
  const data=fixture();
  data.bundleComponentRows.push({
    'Bundle Product ID':'SET-A',Revision:3,
    'Component Product ID':'PIPE','Quantity Per Set':1,
    Status:'Active',Unit:'pcs'
  });
  assert.equal(parity(data).products.find(p=>p.id==='SET-A').stock,2);
});

test('missing current-revision recipe excludes only that bundle',()=>{
  const data=fixture();
  data.bundleComponentRows=data.bundleComponentRows.filter(row=>row['Bundle Product ID']!=='SET-B');
  const output=parity(data);
  assert.deepEqual(output.products.map(p=>p.id),['SET-A','PIPE','WIRE']);
});

test('missing, deleted or inactive physical component hides its bundle but leaves other products',()=>{
  for(const state of ['Inactive','Deleted']){
    const data=fixture();
    const pipe=data.productRows.find(p=>p['Product ID']==='PIPE');
    if(state==='Inactive')pipe.Status='Inactive';
    else pipe['Is Deleted']='TRUE';
    const output=parity(data);
    assert.deepEqual(output.products.map(p=>p.id),['WIRE']);
  }
});

test('duplicate active recipe component IDs invalidate only affected bundle',()=>{
  const data=fixture();
  data.bundleComponentRows.push({
    'Bundle Product ID':'SET-A',Revision:2,'Component Product ID':'WIRE',
    'Quantity Per Set':1,Unit:'pcs',Status:'Active'
  });
  const output=parity(data);
  assert.deepEqual(output.products.map(p=>p.id),['PIPE','SET-B','WIRE']);
});

test('nested bundles never become sellable as components',()=>{
  const data=fixture();
  data.bundleComponentRows.find(row=>row['Bundle Product ID']==='SET-B')['Component Product ID']='SET-A';
  assert.deepEqual(parity(data).products.map(p=>p.id),['SET-A','PIPE','WIRE']);
});

test('zero, negative, unbounded or nonfinite per-set qty invalidates recipe, not stock',()=>{
  for(const qty of [0,-3,1000000001,'not-a-number']){
    const data=fixture();
    data.bundleComponentRows.find(row=>row['Bundle Product ID']==='SET-B')['Quantity Per Set']=qty;
    assert.deepEqual(parity(data).products.map(p=>p.id),['SET-A','PIPE','WIRE']);
  }
});

test('net stock below zero clamps bundle display availability to zero',()=>{
  const data=fixture();
  data.productRows.find(p=>p['Product ID']==='WIRE')['Current Stock']=-5;
  const result=parity(data);
  assert.equal(result.products.find(p=>p.id==='SET-A').stock,0);
  assert.equal(result.products.find(p=>p.id==='SET-B').stock,5);
});

test('fractional component quantities use original floor capacity',()=>{
  const data=fixture();
  data.bundleComponentRows.find(row=>row['Bundle Product ID']==='SET-B')['Quantity Per Set']=1.5;
  assert.equal(parity(data).products.find(p=>p.id==='SET-B').stock,3);
});

test('price visibility and profit permissions preserve dual gate including Bundle rows',()=>{
  for(const allowed of [false,true]){
    const data=fixture();
    data.settings['POS Show Purchase Price']=true;
    data.actorPermissions.posCostView=allowed;
    const result=parity(data);
    assert.equal(result.showPurchasePrice,allowed);
    assert.ok(result.products.every(p=>Object.hasOwn(p,'purchasePrice')===allowed));
    assert.equal(result.canViewCurrentInvoiceProfit,allowed);
    if(allowed)assert.equal(result.products.find(p=>p.id==='SET-A').purchasePrice,0);
  }
});

test('reports profit privilege alone does not reveal Bundle or Standard purchase costs',()=>{
  const data=fixture();
  data.settings['POS Show Purchase Price']=true;
  data.actorPermissions.reportsView=true;
  const result=parity(data);
  assert.equal(result.canViewCurrentInvoiceProfit,true);
  assert.equal(result.showPurchasePrice,false);
  assert.ok(result.products.every(p=>!Object.hasOwn(p,'purchasePrice')));
});

test('original Customer IDs and two different due balances remain distinct despite shared phone',()=>{
  const result=parity(fixture());
  assert.deepEqual(result.customers.map(c=>c.id),['CUS-1','CUS-2']);
  assert.deepEqual(result.customers.map(c=>c.due),[25,-7]);
  assert.equal(result.activeSession.status,'Open');
  assert.equal(result.multiPaymentEnabled,true);
});

test('deleted and inactive Bundle catalog products are omitted without hiding valid Standard products',()=>{
  for(const kind of ['Inactive','Deleted']){
    const data=fixture();
    const row=data.productRows.find(p=>p['Product ID']==='SET-B');
    if(kind==='Inactive')row.Status='Inactive';
    else row['Is Deleted']='TRUE';
    assert.deepEqual(parity(data).products.map(p=>p.id),['SET-A','PIPE','WIRE']);
  }
});

test('missing trusted bundle rows or source snapshots must fail closed before projection',()=>{
  assert.throws(()=>projectPosBootstrapWithBundles(null),/trusted|snapshot/i);
  const data=fixture();
  delete data.bundleComponentRows;
  assert.throws(()=>projectPosBootstrapWithBundles(data),/trusted|bundle/i);
  assert.throws(()=>projectPosBootstrapWithBundles({...fixture(),bundleComponentRows:{}}),
    /trusted|bundle/i);
});

test('cash-session failure cannot be transformed into a successful bundle POS bootstrap',()=>{
  const data=fixture();
  data.sessionResult={success:false,message:'Cash Session closed'};
  assert.deepEqual(sourceBundleBootstrap(clone(data)),{
    success:false,message:'Cash Session closed'
  });
  assert.throws(()=>projectPosBootstrapWithBundles(data),/Cash Session closed/);
});

test('server-derived POS view permission remains mandatory for this internal projection',()=>{
  const data=fixture();
  data.actorPermissions.posView=false;
  assert.equal(sourceBundleBootstrap(clone(data)).success,false);
  assert.throws(()=>projectPosBootstrapWithBundles(data),/permission|authorized/i);
});
