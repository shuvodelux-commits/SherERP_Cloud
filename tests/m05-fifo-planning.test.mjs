import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import vm from 'node:vm';
import * as port from '../src/modules/stock-fifo-planning.js';

const stockSource=readFileSync(new URL('../legacy/source/StockLots.gs',import.meta.url),'utf8');
const utilsSource=readFileSync(new URL('../legacy/source/Utils.gs',import.meta.url),'utf8');
const portSource=readFileSync(new URL('../src/modules/stock-fifo-planning.js',import.meta.url),'utf8');
const stockNames=['compareLotsFifo_','lotSellPrice_','buildLotPricingLadder_',
  'computePlanSellingPrice_','planStockConsumption_','planSaleVendorConsumption_'];
const helperNames=['isValidNonNegativeNumber_','roundMoney_','safeDateOnly_'];
const canonical=(src,names)=>{
  const declarations=parse(src,{ecmaVersion:'latest',sourceType:'module'}).body
    .filter(x=>x.type==='FunctionDeclaration'&&names.includes(x.id.name));
  assert.equal(declarations.length,names.length,'all source functions exist exactly once');
  return Object.fromEntries(declarations.map(x=>[x.id.name,src.slice(x.start,x.end)]));
};
const srcStock=canonical(stockSource,stockNames);
const srcHelpers=canonical(utilsSource,helperNames);
const imported=canonical(portSource,[...stockNames,...helperNames]);

function localFormatDate(value){
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))throw new TypeError('Invalid date');
  const parts=new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(date);
  const dict=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return [dict.year,dict.month,dict.day].join('-');
}
const sourceRuntime=(()=>{
  const context=vm.createContext({
    formatDate_:localFormatDate,
    getAllRows_:()=>{throw new Error('Unexpected implicit GAS read');}
  });
  const text=[...Object.values(srcHelpers),...Object.values(srcStock)].join('\n');
  vm.runInContext(text,context);
  return context;
})();
const native=value=>JSON.parse(JSON.stringify(value));
function same(name,...args){
  const actual=port[name](...args);
  const original=sourceRuntime[name](...args);
  assert.deepEqual(native(actual),native(original),'source parity '+name);
  return actual;
}
const product=(more={})=>({
  'Product ID':'PRD-1','Product Name':'Pipe','Purchase Price':4.5,
  'Selling Price':9,'Current Stock':8,...more
});
const lot=(id,date,qty,cost,sell,supplier,more={})=>({
  'Lot ID':id,'Product ID':'PRD-1','Purchase Date':date,
  'Created At':'2026-11-01T09:00:00Z','Remaining Quantity':qty,
  'Purchase Price':cost,'Sell Price':sell,
  'Supplier ID':supplier,'Status':'Active',
  '_rowIndex':Number(id.slice(-3))+1,...more
});
const lots=()=>[
  lot('LOT-003','2026-11-14',2,4,11,'SUP-B'), // older purchase than its creation
  lot('LOT-002','2026-11-12',3,3,10,'SUP-A',{ 'Created At':'2026-11-14T09:00:00Z'}),
  lot('LOT-001','2026-11-12',1,2,10,'SUP-C',{ 'Created At':'2026-11-15T10:00:00Z'}),
  lot('LOT-004','2026-11-15',4,5,12,'SUP-A'),
  lot('LOT-005','2026-11-09',99,9,9,'SUP-Z',{'Product ID':'OTHER'}),
  lot('LOT-006','2026-11-08',-4,8,8,'SUP-Z',{'Status':'Oversold'}),
];
test('all nine port function declarations remain byte-for-byte source faithful',()=>{
  for(const [name,source] of Object.entries({...srcHelpers,...srcStock})){
    assert.equal(imported[name],source,'GAS source body mismatch: '+name);
    assert.equal(typeof port[name]==='function',true);
  }
});

test('FIFO sort prioritizes Purchase Date, then Lot ID on same day, never Created At',()=>{
  const data=lots();
  assert.deepEqual(data.filter(x=>x['Product ID']==='PRD-1'&&x['Remaining Quantity']>0)
    .sort(port.compareLotsFifo_).map(x=>x['Lot ID']),
    ['LOT-001','LOT-002','LOT-003','LOT-004']);
  same('compareLotsFifo_',data[0],data[1]);
  same('compareLotsFifo_',data[1],data[2]);
});

test('legacy lot with missing purchase date sorts using its Created At; no implicit clock',()=>{
  const a=lot('LOT-010','',1,3,8,'SUP-A',{'Created At':'2026-11-10T02:00:00Z'});
  const b=lot('LOT-011','2026-11-12',1,3,8,'SUP-A');
  assert.equal(same('compareLotsFifo_',a,b),-1);
  const cross=lot('LOT-014','2026-11-15T23:30:00Z',1,3,8,'SUP-A');
  const local=lot('LOT-015','2026-11-16',1,3,8,'SUP-A');
  assert.equal(same('compareLotsFifo_',cross,local),-1); // both Dhaka date 16, lot ID wins
});

test('mixed supplier FIFO consumption is a pure plan with exact lot row indices and costs',()=>{
  const snapshot=lots(),before=structuredClone(snapshot),p=product();
  const result=same('planStockConsumption_','PRD-1',5,snapshot,p);
  assert.deepEqual(result.draws.map(x=>({id:x.lotId,take:x.take,cost:x.unitCost,sell:x.unitSellPrice,row:x.rowIndex})),[
    {id:'LOT-001',take:1,cost:2,sell:10,row:2},
    {id:'LOT-002',take:3,cost:3,sell:10,row:3},
    {id:'LOT-003',take:1,cost:4,sell:11,row:4}
  ]);
  assert.equal(result.shortfall,0);
  assert.deepEqual(snapshot,before,'planning never mutates source lots');
});

test('shortfall records fallback purchase and sell price without writing an oversold lot',()=>{
  const snapshot=lots(),before=structuredClone(snapshot);
  const result=same('planStockConsumption_','PRD-1',12,snapshot,product());
  assert.equal(result.draws.reduce((n,d)=>n+d.take,0),10);
  assert.equal(result.shortfall,2);
  assert.equal(result.fallbackPrice,4.5);
  assert.equal(result.fallbackSellPrice,9);
  assert.equal(result.fallbackName,'Pipe');
  assert.deepEqual(snapshot,before);
  assert.equal(same('computePlanSellingPrice_',result,12).lineTotal,128);
});

test('source-shaped pricing ladder groups adjacent same-price lots and skips Deleted',()=>{
  const source=lots();
  source.push(lot('LOT-008','2026-11-10',2,2,999,'SUP-C',{Status:'Deleted'}));
  const ladder=same('buildLotPricingLadder_','PRD-1',source,product());
  assert.deepEqual(ladder,{segments:[
    {qty:4,sellPrice:10},{qty:2,sellPrice:11},{qty:4,sellPrice:12}
  ],fallbackSellPrice:9,autoSellingPrice:10});
});

test('legacy missing lot Sell Price falls back to product; zero is an explicit valid price',()=>{
  assert.equal(same('lotSellPrice_',lot('LOT-001','2026-11-15',1,2,'','SUP'),product()),9);
  assert.equal(same('lotSellPrice_',lot('LOT-001','2026-11-15',1,2,0,'SUP'),product()),0);
  assert.equal(same('lotSellPrice_',null,product()),9);
});

test('source server-authoritative price uses rounded total before display unit average',()=>{
  const p={draws:[{take:1,unitSellPrice:10.01},{take:2,unitSellPrice:10.02}],
    shortfall:0,fallbackSellPrice:0};
  assert.deepEqual(same('computePlanSellingPrice_',p,3),{unitPrice:10.02,lineTotal:30.05});
  assert.deepEqual(same('computePlanSellingPrice_',{draws:[],shortfall:2,fallbackSellPrice:9},2),
    {unitPrice:9,lineTotal:18});
});

test('vendor shortage uses net owned product stock, not sum of positive lots',()=>{
  const list=lots();
  const own=product({'Current Stock':1});
  const result=same('planSaleVendorConsumption_','PRD-1',6,list,own);
  assert.equal(result.draws.reduce((n,d)=>n+d.take,0),1);
  assert.equal(result.shortfall,5);
  assert.equal(result.draws[0].lotId,'LOT-001');
  const none=same('planSaleVendorConsumption_','PRD-1',6,list,product({'Current Stock':-5}));
  assert.deepEqual(none.draws,[]);
  assert.equal(none.shortfall,6);
});

test('zero and negative requests create empty plans; absent lot/product snapshots reject hidden GAS reads',()=>{
  const list=lots();
  assert.deepEqual(same('planStockConsumption_','PRD-1',0,list,product()).draws,[]);
  assert.deepEqual(same('planStockConsumption_','PRD-1',-1,list,product()).draws,[]);
  assert.deepEqual(same('planSaleVendorConsumption_','PRD-1',0,list,product()).draws,[]);
  assert.throws(()=>port.planStockConsumption_('PRD-1',1,undefined,undefined),/explicit|GAS|snapshot/i);
});

test('source discrepancy is explicitly pinned: Deleted positive lots count in stock plan but not price ladder',()=>{
  const source=[lot('LOT-001','2026-11-01',5,5,5,'SUP-X',{Status:'Deleted'})];
  assert.equal(same('planStockConsumption_','PRD-1',1,source,product()).draws.length,1);
  assert.deepEqual(same('buildLotPricingLadder_','PRD-1',source,product()).segments,[]);
  // Future D1 posting must resolve this legacy discrepancy before activation.
});
