import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSourceStockLotCostAudit,importSourceStockLotCostAuditWithD1} from '../src/db/stock-lot-cost-audit-import.js';

const rows=()=>[
 {'Correction ID':'COR-1',Date:'2026-11-16','Lot ID':'LOT-1','Product ID':'PR-1','Product Name':'তার',Source:'PUR-1',
  'Old Purchase Price':'-0.00','New Purchase Price':12.5,'Original Quantity':20,'Remaining Quantity':'12.00',
  'Matched Historical Quantity':8,'Affected Invoice Count':2,'Historical COGS Delta':'-17.250',Reason:'  adjust  ',
  'Corrected By':'রহিম','Created At':'2026-11-16T10:00Z',_rowIndex:2},
 {'Correction ID':'COR-2',Date:'2026-11-16','Lot ID':'LOT-2','Product ID':'PR-1','Product Name':'তার',Source:'PUR-2',
  'Old Purchase Price':'','New Purchase Price':'0.00','Original Quantity':1,'Remaining Quantity':0,
  'Matched Historical Quantity':1,'Affected Invoice Count':1,'Historical COGS Delta':0,Reason:' correction ',
  'Corrected By':'রহিম','Created At':'2026-11-16T11:00Z',_rowIndex:3}
];
test('source snapshot is projected without rounding, recomputation, normalization or mutation',()=>{
 const original=rows(),clone=structuredClone(original),out=prepareSourceStockLotCostAudit(original);
 assert.equal(out.length,2);
 assert.deepEqual(out.map(x=>x.correction_id),['COR-1','COR-2']);
 assert.deepEqual(out.map(x=>x.legacy_sheet_row),[2,3]);
 assert.equal(out[0].old_purchase_price_text,'-0.00');
 assert.equal(out[0].historical_cogs_delta_text,'-17.250');
 assert.equal(out[1].old_purchase_price_text,'');
 assert.equal(out[1].historical_cogs_delta_text,'0');
 assert.deepEqual(original,clone);
});
test('preflight rejects malformed IDs, duplicate source, row gaps, nonfinite cost, unknown fields',()=>{
 const s=rows();const bad=[
  [],s.slice().reverse(),[s[0],{...s[1],_rowIndex:4}],
  [{...s[0],'Correction ID':' '},s[1]],[s[0],{...s[1],'Correction ID':'COR-1'}],
  [{...s[0],'Lot ID':''},s[1]],[{...s[0],'New Purchase Price':NaN},s[1]],
  [{...s[0],'Historical COGS Delta':Infinity},s[1]],
  [{...s[0],'Affected Invoice Count':{}},s[1]],
  [{...s[0],Reason:null},s[1]],[{...s[0],Extra:'private'},s[1]]
 ];
 for(const value of bad)assert.throws(()=>prepareSourceStockLotCostAudit(value),/invalid|source|duplicate/i);
});
test('unknown symbols and accessor getters reject without reading secret values',()=>{
 const x=rows();Object.defineProperty(x[0],'Reason',{enumerable:true,get(){throw Error('PRIVATE_REASON');}});
 assert.throws(()=>prepareSourceStockLotCostAudit(x),e=>e instanceof Error&&!e.message.includes('PRIVATE_REASON'));
 const y=rows();y[0][Symbol('hidden')]='secret';
 assert.throws(()=>prepareSourceStockLotCostAudit(y),/invalid|source/i);
});
test('native Date is serialized only when present; existing date text stays exact',()=>{
 const x=rows();x[0].Date=new Date('2026-11-16T00:00:00.000Z');
 x[1]['Created At']=new Date('2026-11-16T11:00:00.000Z');
 const v=prepareSourceStockLotCostAudit(x);
 assert.equal(v[0].date_text,'2026-11-16T00:00:00.000Z');
 assert.equal(v[1].created_at_text,'2026-11-16T11:00:00.000Z');
 assert.equal(v[1].date_text,'2026-11-16');
});
test('postcommit readback mismatch returns NEEDS_REVIEW, never falsely claims rollback',async()=>{
 const DB={prepare(sql){
  if(sql.startsWith('SELECT legacy_sheet_row,correction_id'))return {bind(){return {all:async()=>({success:true,results:[]})};}};
  return {bind(){return {};}};
 },batch:async a=>a.map(()=>({success:true}))};
 await assert.rejects(()=>importSourceStockLotCostAuditWithD1({DB,sourceRows:rows()}),/NEEDS_REVIEW/);
});
