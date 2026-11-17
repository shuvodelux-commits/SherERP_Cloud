import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {importSourceStockLotCostAuditWithD1}
  from '../../src/db/stock-lot-cost-audit-import.js';
import {createStockLotCostAuditReadAdapter}
  from '../../src/db/stock-lot-cost-history-read.js';
import publicWorker from '../../src/index.js';

const harness=createTestHarness({workers:[{
  configPath:'./wrangler.m02-stock-lot-cost-audit-test.jsonc'
}]});
const worker=harness.getWorker('shererp-m02-stock-lot-cost-audit-local-only');
const original=()=>[
  {'Correction ID':'COR-1',Date:'2026-11-17','Lot ID':'LOT-1',
    'Product ID':'PR-1','Product Name':'তার',Source:'PUR-1',
    'Old Purchase Price':'-0.00','New Purchase Price':12.5,
    'Original Quantity':20,'Remaining Quantity':'12.00',
    'Matched Historical Quantity':8,'Affected Invoice Count':2,
    'Historical COGS Delta':'-17.250',Reason:'  adjust  ',
    'Corrected By':'রহিম','Created At':'2026-11-17T10:00Z',_rowIndex:2},
  {'Correction ID':'COR-2',Date:'2026-11-17','Lot ID':'LOT-1',
    'Product ID':'PR-1','Product Name':'তার',Source:'PUR-1',
    'Old Purchase Price':'12.50','New Purchase Price':'9.750',
    'Original Quantity':20,'Remaining Quantity':0,
    'Matched Historical Quantity':20,'Affected Invoice Count':3,
    'Historical COGS Delta':'-1.00',Reason:' correction ',
    'Corrected By':'মিতা','Created At':'2026-11-17T11:00Z',_rowIndex:3}
];
const expected=()=>original().map((row,i)=>({
  ...row,
  ...(i===0?{'New Purchase Price':'12.5','Original Quantity':'20',
    'Matched Historical Quantity':'8','Affected Invoice Count':'2'}
    :{'Original Quantity':'20','Remaining Quantity':'0',
      'Matched Historical Quantity':'20','Affected Invoice Count':'3'})
}));
let DB;
const adapter=()=>createStockLotCostAuditReadAdapter({DB});
const select='SELECT legacy_sheet_row,correction_id,date_text,lot_id,product_id,product_name,source,old_purchase_price_text,new_purchase_price_text,original_quantity_text,remaining_quantity_text,matched_historical_quantity_text,affected_invoice_count_text,historical_cogs_delta_text,reason,corrected_by,created_at_text FROM legacy_stock_lot_cost_corrections ORDER BY legacy_sheet_row';
const count=async()=>(await DB.prepare(
  'SELECT COUNT(*) AS n FROM legacy_stock_lot_cost_corrections'
).first()).n;

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  assert.deepEqual(await importSourceStockLotCostAuditWithD1({
    DB,sourceRows:original()
  }),{sourceGroup:'STOCK_LOT_COST_CORRECTIONS',importedRows:2,reconciled:true});
});
after(async()=>harness.close());

test('real D1 imported M02 frozen correction history reads in full original sixteen-column source shape',async()=>{
  const a=adapter();
  assert.deepEqual(await a.getSheetHeaders_('STOCK_LOT_COST_CORRECTIONS'),[
    'Correction ID','Date','Lot ID','Product ID','Product Name','Source',
    'Old Purchase Price','New Purchase Price','Original Quantity',
    'Remaining Quantity','Matched Historical Quantity','Affected Invoice Count',
    'Historical COGS Delta','Reason','Corrected By','Created At'
  ]);
  const rows=await a.getAllRows_('STOCK_LOT_COST_CORRECTIONS');
  assert.deepEqual(rows,expected());
  assert.deepEqual(rows.map(row=>row._rowIndex),[2,3]);
  assert.equal(rows[0]['Old Purchase Price'],'-0.00');
  assert.equal(rows[0]['Historical COGS Delta'],'-17.250');
  assert.equal(rows[0]['New Purchase Price'],'12.5',
    'numeric M02 source values become descriptive TEXT, never rounded');
  assert.equal(rows[1]['New Purchase Price'],'9.750');
  assert.equal(rows[0].Reason,'  adjust  ');
  assert.equal(rows[1]['Corrected By'],'মিতা');
  assert(rows.every(row=>!Object.hasOwn(row,'row_id')));
  assert.equal(await count(),2);
});

test('M03 exact string matches preserve multiple corrections of same Lot and first original physical row',async()=>{
  const a=adapter();
  assert.deepEqual(await a.findRows_('STOCK_LOT_COST_CORRECTIONS','Lot ID','LOT-1'),expected());
  assert.deepEqual(await a.findRows_('STOCK_LOT_COST_CORRECTIONS','Product ID','PR-1'),expected());
  assert.deepEqual(await a.findFirstRow_('STOCK_LOT_COST_CORRECTIONS','Lot ID','LOT-1'),expected()[0]);
  assert.deepEqual(await a.findRow_('STOCK_LOT_COST_CORRECTIONS','Correction ID','COR-2'),{
    row:expected()[1],rowIndex:3
  });
  assert.equal(await a.findRowIndex_('STOCK_LOT_COST_CORRECTIONS','Correction ID','COR-2'),3);
  assert.equal(await a.findRowIndex_('STOCK_LOT_COST_CORRECTIONS','Correction ID','absent'),-1);
  assert.equal(await a.findFirstRow_('STOCK_LOT_COST_CORRECTIONS','New Purchase Price','9.75'),null);
});

test('real local D1 immutable archive does not mutate financial state and rejects SQL update/delete',async()=>{
  const before=(await DB.prepare(select).all()).results;
  await adapter().getAllRows_('STOCK_LOT_COST_CORRECTIONS');
  await adapter().findRows_('STOCK_LOT_COST_CORRECTIONS','Lot ID','LOT-1');
  assert.deepEqual((await DB.prepare(select).all()).results,before);
  await assert.rejects(()=>DB.prepare(
    "UPDATE legacy_stock_lot_cost_corrections SET historical_cogs_delta_text='0' WHERE correction_id='COR-1'"
  ).run(),/immutable/i);
  await assert.rejects(()=>DB.prepare(
    "DELETE FROM legacy_stock_lot_cost_corrections WHERE correction_id='COR-1'"
  ).run(),/immutable/i);
  assert.equal(await count(),2);
});

test('isolated test Worker and public DB-free RPC cannot expose historical corrected costs',async()=>{
  for(const path of ['/api/rpc','/__m03_test__/stock-lot-cost-history',
    '/__m02_test__/stock-lot-cost-audit','/api/health']){
    const response=await worker.fetch('http://synthetic.local'+path,{
      method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
    });
    assert.equal(response.status,404,path);
  }
  const response=await publicWorker.fetch(new Request('https://public.invalid/api/rpc',{
    method:'POST',
    headers:{Origin:'https://public.invalid','Content-Type':'application/json'},
    body:JSON.stringify({fnName:'getAllRows_',args:['STOCK_LOT_COST_CORRECTIONS']})
  }),{DB});
  assert.equal(response.status,501);
  assert.deepEqual(await response.json(),{success:false,message:'RPC method not migrated'});
  assert.equal(JSON.parse(readFileSync(new URL('../../wrangler.preview.jsonc',import.meta.url),'utf8')).d1_databases,undefined);
  assert.equal(readFileSync(new URL('../../src/index.js',import.meta.url),'utf8').includes('stock-lot-cost-history-read'),false);
  assert.equal(readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8').includes('STOCK_LOT_COST_CORRECTIONS'),false);
});

test('broken original physical row provenance is rejected with no partial source results',async()=>{
  await DB.prepare(
    'INSERT INTO legacy_stock_lot_cost_corrections(legacy_sheet_row,correction_id,lot_id,product_id) VALUES(?,?,?,?)'
  ).bind(8,'COR-GAPPED','LOT-1','PR-1').run();
  await assert.rejects(()=>adapter().getAllRows_('STOCK_LOT_COST_CORRECTIONS'),
    /archive|invalid|source/i);
  await assert.rejects(()=>adapter().findRowIndex_('STOCK_LOT_COST_CORRECTIONS','Correction ID','COR-1'),
    /archive|invalid|source/i);
  assert.equal(await count(),3);
});
