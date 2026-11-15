import {test} from 'node:test';
import assert from 'node:assert/strict';
import {originalPosBootstrap} from './fixtures/m06-pos-bootstrap-oracle.mjs';
import {projectStandardPosBootstrap} from '../src/modules/pos-bootstrap-standard.js';

const copy=value=>JSON.parse(JSON.stringify(value));
function fixture(){
  return {
    productRows:[
      {'Product ID':'PIPE','Product Name':'Pipe','Product Type':'Standard',
        Status:'Active','Is Deleted':'FALSE',Brand:'Local',Unit:'Feet',Barcode:'P-1',
        'Selling Price':20,'Purchase Price':8,'Current Stock':6,Category:'Hardware'},
      {'Product ID':'WIRE','Product Name':'Wire','Product Type':'Standard',
        Status:'Active','Is Deleted':'FALSE',Unit:'Roll','Selling Price':40,
        'Purchase Price':17,'Current Stock':0,Category:'Electrical'},
      {'Product ID':'HIDDEN','Product Name':'Deleted','Product Type':'Standard',
        Status:'Active','Is Deleted':'TRUE','Selling Price':55,'Purchase Price':29},
      {'Product ID':'INACTIVE','Product Name':'Inactive','Product Type':'Standard',
        Status:'Inactive','Is Deleted':'FALSE','Selling Price':55,'Purchase Price':29}
    ],
    stockLots:[
      {'Lot ID':'LOT-2','Product ID':'PIPE','Purchase Date':'2026-11-14',
        'Remaining Quantity':4,'Sell Price':22,Status:'Active'},
      {'Lot ID':'LOT-1','Product ID':'PIPE','Purchase Date':'2026-11-12',
        'Remaining Quantity':2,'Sell Price':17,Status:'Active'},
      {'Lot ID':'LOT-3','Product ID':'PIPE','Purchase Date':'2026-11-15',
        'Remaining Quantity':7,'Sell Price':10,Status:'Deleted'},
      {'Lot ID':'LOT-4','Product ID':'WIRE','Purchase Date':'2026-11-10',
        'Remaining Quantity':-2,'Sell Price':34,Status:'Oversold'}
    ],
    customerRows:[
      {'Customer ID':'CUS-1','Customer Name':'Alpha','Phone':'01711111111',
        'Address':'A','Father Name':'Father A','Relation Type':'Father',
        'Current Due':-12.5,'Is Deleted':'FALSE'},
      {'Customer ID':'CUS-2','Customer Name':'Beta','Phone':'01711111111',
        'Address':'B','Father Name':'Husband B','Relation Type':'Husband',
        'Current Due':75,'Is Deleted':'FALSE'},
      {'Customer ID':'CUS-OLD','Customer Name':'Deleted','Phone':'01810000000',
        'Is Deleted':'TRUE','Current Due':10}
    ],
    vendors:[{id:'VEND-1',name:'Active Vendor'}],
    vendorsAll:[{id:'VEND-1',name:'Active Vendor'},{id:'VEND-2',name:'Inactive Vendor'}],
    bankAccounts:[{id:'BANK-1',name:'Shop Bank',type:'Bank'}],
    sessionResult:{success:true,data:{id:'SESSION-7',status:'Open'}},
    actorPermissions:{posView:true,posCostView:false,reportsView:false},
    settings:{
      'Shop Name':'Shop One','Currency Symbol':'৳','Tax Percent':'7.5',
      'POS Show Purchase Price':false,'POS Multi Payment Enabled':'true'
    }
  };
}
function parity(input){
  const before=copy(input);
  const original=originalPosBootstrap(copy(input));
  assert.equal(original.success,true,JSON.stringify(original));
  const actual=projectStandardPosBootstrap(input);
  assert.deepEqual(copy(actual),original.data);
  assert.deepEqual(input,before,'POS bootstrap projection must be pure');
  return actual;
}

test('standard POS bootstrap equals source including original lot ladder and session',()=>{
  const actual=parity(fixture());
  assert.deepEqual(actual.products.map(x=>x.id),['PIPE','WIRE']);
  assert.deepEqual(actual.products[0].lotPricing,[
    {qty:2,sellPrice:17},{qty:4,sellPrice:22}
  ]);
  assert.equal(actual.products[0].autoSellingPrice,17);
  assert.equal(actual.products[0].fallbackSellPrice,20);
  assert.equal(actual.products[0].stock,6);
  assert.equal(actual.products[1].autoSellingPrice,40);
  assert.equal(actual.activeSession.id,'SESSION-7');
  assert.equal(actual.products[0].productType,'Standard');
  assert.equal(actual.products[0].bundleRevision,0);
});

test('source costs must be entirely absent from payload with permission disabled',()=>{
  const input=fixture();
  input.settings['POS Show Purchase Price']='true';
  const actual=parity(input);
  assert.equal(actual.showPurchasePrice,false);
  assert.equal(actual.canViewCurrentInvoiceProfit,false);
  assert.ok(actual.products.every(p=>!Object.hasOwn(p,'purchasePrice')));
});

test('cost setting true plus user posCost.view unlocks price, including true boolean',()=>{
  for(const setting of [true,'TRUE',' true ']){
    const input=fixture();
    input.actorPermissions.posCostView=true;
    input.settings['POS Show Purchase Price']=setting;
    const actual=parity(input);
    assert.equal(actual.showPurchasePrice,true);
    assert.equal(actual.canViewCurrentInvoiceProfit,true);
    assert.deepEqual(actual.products.map(p=>p.purchasePrice),[8,17]);
  }
});

test('reports.view can expose aggregate profit permission but never product purchase cost',()=>{
  const input=fixture();
  input.settings['POS Show Purchase Price']=true;
  input.actorPermissions.reportsView=true;
  const result=parity(input);
  assert.equal(result.canViewCurrentInvoiceProfit,true);
  assert.equal(result.showPurchasePrice,false);
  assert.ok(result.products.every(p=>!Object.hasOwn(p,'purchasePrice')));
});

test('individual cost permission does not bypass the business-wide cost setting',()=>{
  const input=fixture();
  input.actorPermissions.posCostView=true;
  const result=parity(input);
  assert.equal(result.canViewCurrentInvoiceProfit,true);
  assert.equal(result.showPurchasePrice,false);
  assert.ok(!Object.hasOwn(result.products[0],'purchasePrice'));
});

test('deleted and inactive products are omitted rather than exposing stale stock or cost',()=>{
  const input=fixture();
  input.actorPermissions.posCostView=true;
  input.settings['POS Show Purchase Price']=true;
  const result=parity(input);
  assert.deepEqual(result.products.map(p=>p.id),['PIPE','WIRE']);
  assert.equal(result.products.some(p=>p.id==='HIDDEN'||p.id==='INACTIVE'),false);
});

test('two customers sharing phone remain independent legacy Customer IDs and due buckets',()=>{
  const result=parity(fixture());
  assert.deepEqual(result.customers.map(c=>c.id),['CUS-1','CUS-2']);
  assert.deepEqual(result.customers.map(c=>c.due),[-12.5,75]);
  assert.deepEqual(result.customers.map(c=>c.relationType),['Father','Husband']);
  assert.equal(result.customers[1].fatherName,'Husband B');
});

test('bank, vendor active/all, shop currency and tax are projected unmodified',()=>{
  const result=parity(fixture());
  assert.equal(result.multiPaymentEnabled,true);
  assert.deepEqual(result.bankAccounts,[{id:'BANK-1',name:'Shop Bank',type:'Bank'}]);
  assert.equal(result.vendors.length,1);
  assert.equal(result.vendorsAll.length,2);
  assert.equal(result.shopName,'Shop One');
  assert.equal(result.currencySymbol,'৳');
  assert.equal(result.taxPercent,7.5);
});

test('multi-payment switch requires literal source true; missing shop falls back to source name',()=>{
  for(const setting of ['enabled','1',true,'FALSE','']){
    const input=fixture();
    input.settings['POS Multi Payment Enabled']=setting;
    delete input.settings['Shop Name'];
    const output=parity(input);
    assert.equal(output.multiPaymentEnabled,setting===true||String(setting).toLowerCase()==='true');
    assert.equal(output.shopName,'SherERP');
  }
});

test('source fallback when Sell Price missing or adjacent FIFO lots share a price',()=>{
  const input=fixture();
  input.stockLots[0]['Sell Price']=17;
  input.stockLots.push({'Lot ID':'LOT-5','Product ID':'WIRE',
    'Purchase Date':'2026-11-11','Remaining Quantity':2,
    'Sell Price':'',Status:'Active'});
  const output=parity(input);
  assert.deepEqual(output.products[0].lotPricing,[{qty:6,sellPrice:17}]);
  assert.deepEqual(output.products[1].lotPricing,[{qty:2,sellPrice:40}]);
});

test('cash session failure is not disguised as an open drawer',()=>{
  const input=fixture();
  input.sessionResult={success:false,message:'Cash session is closed'};
  const original=originalPosBootstrap(copy(input));
  assert.deepEqual(original,{success:false,message:'Cash session is closed'});
  assert.throws(()=>projectStandardPosBootstrap(input),/Cash session is closed/);
});

test('unauthorized pos.view is never accepted as authorized bootstrap input',()=>{
  const input=fixture();
  input.actorPermissions.posView=false;
  const original=originalPosBootstrap(copy(input));
  assert.equal(original.success,false);
  assert.throws(()=>projectStandardPosBootstrap(input),/permission|authorized/i);
});

test('missing trusted source arrays, permissions, settings and session fail closed',()=>{
  const input=fixture();
  assert.throws(()=>projectStandardPosBootstrap(null),/trusted|snapshot/i);
  for(const field of ['productRows','customerRows','stockLots','bankAccounts',
    'vendors','vendorsAll','actorPermissions','settings','sessionResult']){
    const broken=fixture();
    delete broken[field];
    assert.throws(()=>projectStandardPosBootstrap(broken),/trusted|snapshot/i,field);
  }
});

test('bundle row is refused until M05-approved component availability path is integrated',()=>{
  const input=fixture();
  input.productRows[0]['Product Type']='Bundle';
  input.productRows[0]['Bundle Revision']=1;
  assert.throws(()=>projectStandardPosBootstrap(input),/bundle|unsupported/i);
});
