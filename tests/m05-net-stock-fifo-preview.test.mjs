import test from 'node:test';
import assert from 'node:assert/strict';
import {planNetOwnedStockPreview} from '../src/modules/m05-net-stock-fifo-preview.js';

const product=(stock=9)=>({'Product ID':'P','Product Name':'Pipe','Current Stock':stock,'Purchase Price':68,'Selling Price':70});
const lot=(id,qty,date='2026-11-19',options={})=>({'Lot ID':id,'Product ID':'P','Purchase Date':date,'Remaining Quantity':qty,'Purchase Price':64.75,'Sell Price':70,'Status':'Active','Purchase ID':'PUR-82','_rowIndex':3,...options});
const lots=()=>[
  lot('LOT-000939',-229,'2026-11-01',{'Status':'Oversold','Purchase ID':'OVERSOLD','Purchase Price':68}),
  lot('LOT-OTHER-2',-2,'2026-11-15',{'Status':'Oversold','Purchase ID':'OVERSOLD','Purchase Price':68}),
  lot('LOT-000940',240,'2026-11-19'),
];
const plan=(quantity, allLots=lots(), p=product(), extras={})=>planNetOwnedStockPreview({productId:'P',quantity,allLots,productRow:p,...extras});

test('prevents gross 240 Foot from being offered after 231 Foot prior OVERSOLD; 10 requested gives 9 owned, 1 shortfall',()=>{
 const input=lots(), before=structuredClone(input), p=product(), prev=structuredClone(p);
 const result=plan(10,input,p);
 assert.deepEqual(result.consumption.draws.map(d=>({lotId:d.lotId,take:d.take,cost:d.unitCost})),[
  {lotId:'LOT-000940',take:9,cost:64.75}
 ]);
 assert.equal(result.consumption.shortfall,1);
 assert.deepEqual(result.pricing.segments,[{qty:9,sellPrice:70}]);
 assert.equal(result.netOwnedQty,9);
 assert.equal(result.reservedOversoldQty,231);
 assert.equal(result.provisional,true);
 assert.deepEqual(input,before);
 assert.deepEqual(p,prev);
});

test('a 1-foot sale uses 1 physical foot and the correct lot cost after virtual reserve',()=>{
 const res=plan(1);
 assert.equal(res.consumption.draws[0].take,1);
 assert.equal(res.consumption.draws[0].unitCost,64.75);
 assert.equal(res.consumption.shortfall,0);
 assert.ok(!('remainingAfter' in res.consumption.draws[0]));
 assert.ok(!('rowIndex' in res.consumption.draws[0]));
});

test('vendor sourcing uses only 9 owned feet, and requests vendor-sourcing for the extra 1 Foot',()=>{
 const res=plan(10,lots(),product(),{vendorSourced:true});
 assert.equal(res.consumption.draws.reduce((n,d)=>n+d.take,0),9);
 assert.equal(res.consumption.shortfall,1);
});

test('no negative lots retains ordinary multi-supplier FIFO, using all 5 net owned feet',()=>{
 const data=[lot('L-01',2,'2026-11-01'),lot('L-02',3,'2026-11-02',{'Sell Price':72})];
 const res=plan(6,data,product(5));
 assert.deepEqual(res.consumption.draws.map(d=>[d.lotId,d.take]),[['L-01',2],['L-02',3]]);
 assert.equal(res.consumption.shortfall,1);
 assert.deepEqual(res.pricing.segments,[{qty:2,sellPrice:70},{qty:3,sellPrice:72}]);
 assert.equal(res.provisional,false);
});

test('zero quantity still returns net-eligible pricing ladder, without a stock movement',()=>{
 const res=plan(0);
 assert.deepEqual(res.consumption.draws,[]);
 assert.equal(res.consumption.shortfall,0);
 assert.equal(res.pricing.segments[0].qty,9);
});

test('a net-negative product cannot offer any positive owned stock',()=>{
 const data=[lot('NEG',-3,'2026-11-18',{'Status':'Oversold','Purchase ID':'OVERSOLD'})];
 const res=plan(2,data,product(-3));
 assert.deepEqual(res.consumption.draws,[]);
 assert.equal(res.consumption.shortfall,2);
 assert.equal(res.pricing.segments.length,0);
});

test('mismatched cached and aggregate stock refuses to invent an allocation',()=>{
 assert.throws(()=>plan(1,[lots()[0],lots()[2]],product(9)),/mismatch|review/i);
});

test('deleted positive lot blocks preview even when other lot could fulfill the sale',()=>{
 const data=lots();data[2].Status='Deleted';
 assert.throws(()=>plan(1,data,product()),/deleted/i);
});

test('unknown negative lot source/status cannot be treated as historical OVERSOLD',()=>{
 const data=lots();data[0]['Purchase ID']='ADJUSTMENT';
 assert.throws(()=>plan(1,data,product()),/negative.*source|review|oversold/i);
});

test('ambiguous multiple positive lots and existing shortage must not guess which purchase funded historical sales',()=>{
 const data=[lot('L-OLDER',5,'2026-10-01'),...lots()];
 assert.throws(()=>plan(1,data,product(14)),/ambiguous|review/i);
});

test('invalid quantity, malformed lot, duplicate lot ID, and invalid stock fail closed',()=>{
 assert.throws(()=>plan(-1),/quantity/i);
 assert.throws(()=>plan(Infinity),/quantity/i);
 assert.throws(()=>plan(1,[null],product()),/lot/i);
 const duplicate=lots();duplicate.push({...duplicate[2]});
 assert.throws(()=>plan(1,duplicate,product(249)),/duplicate/i);
 assert.throws(()=>plan(1,lots(),product(NaN)),/stock/i);
});

test('other product lots are ignored and no mutation occurs',()=>{
 const data=[...lots(),lot('EXTERNAL',500,'2026-11-01',{'Product ID':'ANOTHER'})];
 const before=structuredClone(data);
 const res=plan(1,data,product());
 assert.equal(res.netOwnedQty,9);
 assert.equal(res.consumption.draws[0].lotId,'LOT-000940');
 assert.deepEqual(data,before);
});


test('preview cannot be mistaken for a posting plan with row indexes or tentative remainingAfter',()=>{
 const result=plan(9);
 assert.equal(result.postable,false);
 for (const draw of result.consumption.draws) {
  assert.equal('rowIndex' in draw,false);
  assert.equal('remainingAfter' in draw,false);
 }
});

test('backdated replenishment cannot provisionally settle an OVERSOLD event that occurred afterward',()=>{
 const input=lots(); input[0]['Purchase Date']='2026-11-20';
 assert.throws(()=>plan(1,input,product()),/date|backdated|review/i);
});

test('unpriced or invalid purchase lot cost blocks trusted purchase-cost preview',()=>{
 for (const cost of [null,'bad-price',-1,0]) {
  const input=lots();input[2]['Purchase Price']=cost;
  assert.throws(()=>plan(1,input,product()),/cost|unpriced|review/i);
 }
});
