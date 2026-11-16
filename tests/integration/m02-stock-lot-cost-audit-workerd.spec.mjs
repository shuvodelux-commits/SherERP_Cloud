import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {importSourceStockLotCostAuditWithD1} from '../../src/db/stock-lot-cost-audit-import.js';
const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-stock-lot-cost-audit-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-stock-lot-cost-audit-local-only');
let DB;
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
const count=async()=>(await DB.prepare('SELECT COUNT(*) n FROM legacy_stock_lot_cost_corrections').first()).n;
const read=async()=>(await DB.prepare('SELECT legacy_sheet_row,correction_id,date_text,lot_id,product_id,product_name,source,old_purchase_price_text,new_purchase_price_text,original_quantity_text,remaining_quantity_text,matched_historical_quantity_text,affected_invoice_count_text,historical_cogs_delta_text,reason,corrected_by,created_at_text FROM legacy_stock_lot_cost_corrections ORDER BY legacy_sheet_row').all()).results;
before(async()=>{await harness.listen();await worker.applyD1Migrations('DB');({DB}=await worker.getEnv());});
after(async()=>harness.close());
test('preflight prevents all writes on malformed source',async()=>{
 const sample=rows();
 for(const s of [[],sample.slice().reverse(),[sample[0],{...sample[1],'Correction ID':'COR-1'}],
  [{...sample[0],'New Purchase Price':Infinity},sample[1]]]){
  await assert.rejects(()=>importSourceStockLotCostAuditWithD1({DB,sourceRows:s}),/invalid|source|duplicate/i);
  assert.equal(await count(),0);
 }
});
test('a failed second insert rolls back the whole D1 batch',async()=>{
 await DB.prepare("CREATE TRIGGER m02_late_fail BEFORE INSERT ON legacy_stock_lot_cost_corrections WHEN NEW.correction_id='COR-2' BEGIN SELECT RAISE(ABORT,'synthetic late failure'); END").run();
 try{
  await assert.rejects(()=>importSourceStockLotCostAuditWithD1({DB,sourceRows:rows()}),/D1|failed/i);
  assert.equal(await count(),0);
 }finally{await DB.prepare('DROP TRIGGER m02_late_fail').run();}
});
test('only one concurrent source import succeeds and retains original signed COGS evidence',async()=>{
 const data=rows(),copy=JSON.stringify(data);
 const outcomes=await Promise.allSettled([
   importSourceStockLotCostAuditWithD1({DB,sourceRows:data}),
   importSourceStockLotCostAuditWithD1({DB,sourceRows:rows()})
 ]);
 assert.deepEqual(outcomes.map(x=>x.status).sort(),['fulfilled','rejected']);
 assert.deepEqual(outcomes.find(x=>x.status==='fulfilled').value,{
  sourceGroup:'STOCK_LOT_COST_CORRECTIONS',importedRows:2,reconciled:true
 });
 assert.equal(JSON.stringify(data),copy);
 const result=await read();
 assert.deepEqual(result.map(x=>x.correction_id),['COR-1','COR-2']);
 assert.equal(result[0].old_purchase_price_text,'-0.00');
 assert.equal(result[0].historical_cogs_delta_text,'-17.250');
 assert.equal(result[1].old_purchase_price_text,'');
 assert.equal(result[0].reason,'  adjust  ');
});
test('replay, different snapshot, UPDATE and DELETE are rejected without history changes',async()=>{
 const previous=await read();
 await assert.rejects(()=>importSourceStockLotCostAuditWithD1({DB,sourceRows:rows()}),/D1|failed/i);
 const x=rows();x[1].Reason='forged';
 await assert.rejects(()=>importSourceStockLotCostAuditWithD1({DB,sourceRows:x}),/D1|failed/i);
 await assert.rejects(()=>DB.prepare("UPDATE legacy_stock_lot_cost_corrections SET reason='forged'").run(),/immutable/i);
 await assert.rejects(()=>DB.prepare('DELETE FROM legacy_stock_lot_cost_corrections').run(),/immutable/i);
 assert.deepEqual(await read(),previous);
});
test('isolated test Worker has no public import or financial posting endpoints',async()=>{
 for(const path of ['/api/rpc','/__m02_test__/stock-correction','/api/health']){
  const response=await worker.fetch('http://synthetic.local'+path,{method:'POST',body:'{}'});
  assert.equal(response.status,404);
 }
});
