import test from 'node:test';
import assert from 'node:assert/strict';
import {projectStockReport} from '../src/modules/stock-report-read.js';

const product=(id)=>({
  'Product ID':id,'Product Name':'Cable','Status':'Active','Category':'Electrical',
  'Current Stock':2,'Minimum Stock':1,'Purchase Price':3,'Selling Price':8
});
const lot=(id,qty=2)=>({
  'Lot ID':'LOT-1','Product ID':id,'Remaining Quantity':qty,'Purchase Price':5
});
const stock=(products,lots)=>({activeProducts:products,stockLots:lots});

test('M09 rejects absent, blank and nontext original Product IDs instead of manufacturing grouped identities',()=>{
  const invalid=[
    undefined,null,'','   ',0,42,false,true,{},Symbol('not-an-id')
  ];
  for(const value of invalid){
    const p=product(value);
    assert.throws(()=>projectStockReport(stock([p],[lot('P-1')])),/Product ID/i,
      'invalid product Product ID: '+String(value));
  }
  const noProductId={'Product Name':'No ID','Current Stock':1};
  assert.throws(()=>projectStockReport(stock([noProductId],[])),/Product ID/i);
});

test('M09 rejects missing Stock Lot Product ID even if quantity is zero or negative',()=>{
  for(const quantity of [2,0,-1]){
    for(const id of [undefined,null,'','   ',0]){
      assert.throws(()=>projectStockReport(stock([product('P-1')],[lot(id,quantity)])),
        /Product ID/i,'invalid lot Product ID: '+String(id));
    }
    assert.throws(()=>projectStockReport(stock([product('P-1')],[
      {'Lot ID':'LOT-NO-ID','Remaining Quantity':quantity,'Purchase Price':5}
    ])),/Product ID/i);
  }
});

test('M09 valid IDs retain frozen-source report formulas, unmapped orphan lot and exact grouping',()=>{
  const snapshot=stock([product('P-1')],[
    lot('P-1',2),
    {'Lot ID':'LOT-ORPHAN','Product ID':'OLD-REMOVED','Remaining Quantity':10,'Purchase Price':100},
    {'Lot ID':'LOT-NEG','Product ID':'P-1','Remaining Quantity':-5,'Purchase Price':99}
  ]);
  const before=JSON.stringify(snapshot);
  const result=projectStockReport(snapshot);
  assert.equal(JSON.stringify(snapshot),before);
  assert.equal(result.products[0].productId,'P-1');
  assert.equal(result.products[0].lotValue,10);
  assert.equal(result.products[0].lotQuantity,2);
  assert.equal(result.totals.inventoryValue,10);
  assert.equal(result.totals.retailValue,16);
  assert.equal(result.totals.mismatchCount,0);
  assert.deepEqual(result.byCategory,[{label:'Electrical',products:1,stock:2,value:10}]);
});
