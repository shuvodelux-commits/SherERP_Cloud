import test from 'node:test';
import assert from 'node:assert/strict';
import {auditOversoldExposure} from '../src/modules/m05-oversold-exposure-audit.js';

const product = stock => ({'Product ID':'P-PIPE','Product Name':'4" SWR Pipe RFL 2.9','Current Stock':stock,'Purchase Price':68,'Unit':'Foot'});
const purchase = (id,qty,cost) => ({'Lot ID':id,'Product ID':'P-PIPE','Purchase ID':'PUR-000082','Purchase Date':'2026-11-19','Purchase Price':cost,'Original Quantity':qty,'Remaining Quantity':qty,'Status':'Active'});
const oversold = (id,qty,cost=68) => ({'Lot ID':id,'Product ID':'P-PIPE','Purchase ID':'OVERSOLD','Purchase Date':'2026-11-19','Purchase Price':cost,'Original Quantity':qty,'Remaining Quantity':-qty,'Status':'Oversold'});
function snapshot(currentStock,shortages=[229,2]) {
  const stockLots=[oversold('LOT-000939',shortages[0]), ...shortages.slice(1).map((n,i)=>oversold('LOT-OTHER-'+i,n)),purchase('LOT-000940',240,64.75)];
  return {
    products:[product(currentStock)],stockLots,
    saleItemLots:shortages.map((n,i)=>({'Invoice ID':'INV-'+(i+1),'Product ID':'P-PIPE','Lot ID':i===0?'LOT-000939':'LOT-OTHER-'+(i-1),'Quantity':n,'Unit Cost':68})),
    purchaseItems:[{'Purchase ID':'PUR-000082','Product ID':'P-PIPE','Quantity':240,'Unit Price':64.75}],
    stockMovements:[{'Movement ID':'M-1','Product ID':'P-PIPE','Type':'Purchase','Reference':'PUR-000082','Lot ID':'LOT-000940','Quantity In':240,'Quantity Out':''}]
  };
}
const lookup = r => r.products.find(p=>p.productId==='P-PIPE');

test('full 231-foot shortage explains positive 9 Foot but negative -168 raw value without mutating records', () => {
  const input=snapshot(9), before=structuredClone(input);
  const report=auditOversoldExposure(input);
  const row=lookup(report);
  assert.equal(row.cachedStock,9);
  assert.equal(row.lotStock,9);
  assert.equal(row.grossPositiveQty,240);
  assert.equal(row.oversoldQty,231);
  assert.equal(row.rawLotValue,-168);
  assert.equal(row.conditionalRemainingValue,582.75);
  assert.equal(row.conditionalRemainingQty,9);
  assert.equal(row.conditionalCostVariance,750.75);
  assert.equal(row.status,'PROVISIONAL_ONLY');
  assert.deepEqual(row.negativeLotIds,['LOT-000939','LOT-OTHER-0']);
  assert.deepEqual(input,before);
});

test('visible -229 Foot and +240 Foot only imply 11 Foot; never invent missing -2 Foot', () => {
  const report=auditOversoldExposure(snapshot(9,[229]));
  const row=lookup(report);
  assert.equal(row.lotStock,11);
  assert.equal(row.cachedStock,9);
  assert.equal(row.difference,2);
  assert.equal(row.oversoldQty,229);
  assert.equal(row.conditionalRemainingValue,null);
  assert.ok(report.issues.some(i=>i.code==='STOCK_MISMATCH' && i.productId==='P-PIPE'));
});

test('when source row says 11 Foot and only 229 oversold, conditional valuation is 712.25 not 582.75',()=>{
  const row=lookup(auditOversoldExposure(snapshot(11,[229])));
  assert.equal(row.conditionalRemainingQty,11);
  assert.equal(row.conditionalRemainingValue,712.25);
  assert.equal(row.conditionalCostVariance,744.25);
});

test('rejects orphan lots, duplicate lot identifiers and deleted positive purchase lots from actionable valuation',()=>{
  const input=snapshot(9);
  input.stockLots.push({...input.stockLots[2],'Lot ID':'LOT-ORPHAN','Product ID':'NOT-FOUND'});
  input.stockLots.push({...input.stockLots[2]});
  input.stockLots[2].Status='Deleted';
  const report=auditOversoldExposure(input);
  assert.equal(lookup(report).conditionalRemainingValue,null);
  for(const code of ['ORPHAN_LOT','DUPLICATE_LOT_ID','DELETED_POSITIVE_LOT']) assert.ok(report.issues.some(i=>i.code===code),code);
});

test('does not guess missing old sale consumption links or ambiguous purchase lineage',()=>{
  const input=snapshot(9);
  input.saleItemLots=[];
  input.purchaseItems.push({...input.purchaseItems[0]});
  const report=auditOversoldExposure(input);
  assert.ok(report.issues.some(i=>i.code==='UNVERIFIED_OVERSOLD_CONSUMPTION'));
  assert.ok(report.issues.some(i=>i.code==='AMBIGUOUS_PURCHASE_LINE'));
  assert.equal(lookup(report).conditionalRemainingValue,null);
});

test('rejects malformed stored cost without defaulting it to zero',()=>{
  const input=snapshot(9);
  input.stockLots[2]['Purchase Price']='bad';
  const report=auditOversoldExposure(input);
  assert.equal(lookup(report).rawLotValue,null);
  assert.equal(lookup(report).conditionalRemainingValue,null);
  assert.ok(report.issues.some(i=>i.code==='INVALID_LOT_COST'));
});

test('preserves no-lot zero-stock product while reporting nonzero products without lots',()=>{
  const input={products:[{'Product ID':'P-EMPTY','Current Stock':0},{'Product ID':'P-MISSING','Current Stock':5}],stockLots:[],saleItemLots:[],purchaseItems:[],stockMovements:[]};
  const report=auditOversoldExposure(input);
  assert.equal(report.products[0].status,'NO_LOTS_ZERO');
  assert.equal(report.products[1].status,'NEEDS_REVIEW');
  assert.ok(report.issues.some(i=>i.code==='NO_LOTS_NONZERO'));
});
