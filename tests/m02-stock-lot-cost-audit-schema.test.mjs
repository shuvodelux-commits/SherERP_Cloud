import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {inventorySchema} from '../scripts/inventory-schema.mjs';
import {stockLotCostAuditMapping,verifyStockLotCostAuditMapping,mapStockLotCostAuditRecord} from '../src/db/stock-lot-cost-audit-mapping.js';

const columns=['Correction ID','Date','Lot ID','Product ID','Product Name','Source',
  'Old Purchase Price','New Purchase Price','Original Quantity','Remaining Quantity',
  'Matched Historical Quantity','Affected Invoice Count','Historical COGS Delta',
  'Reason','Corrected By','Created At'];
const inventory=inventorySchema(readFileSync(new URL('../legacy/source/Config.gs',import.meta.url),'utf8'));
const fixture=()=>({'Correction ID':'COR-1',Date:'2026-11-16T09:00Z',
  'Lot ID':'LOT-1','Product ID':'PR-1','Product Name':'তার',
  Source:'PUR-1','Old Purchase Price':'-0.00','New Purchase Price':12.5,
  'Original Quantity':20,'Remaining Quantity':'12.00',
  'Matched Historical Quantity':8,'Affected Invoice Count':2,
  'Historical COGS Delta':'-17.250',Reason:'  corrected  ',
  'Corrected By':'রহিম','Created At':'2026-11-16T10:00Z',_rowIndex:2});

test('exact pinned 16-field source contract preserves correction ID, cost text, actor and provenance',()=>{
  assert.deepEqual(inventory.tables.find(x=>x.sheetKey==='STOCK_LOT_COST_CORRECTIONS')?.columns,columns);
  assert.equal(verifyStockLotCostAuditMapping(inventory),true);
  assert.equal(stockLotCostAuditMapping.table,'legacy_stock_lot_cost_corrections');
  assert.deepEqual(Object.keys(stockLotCostAuditMapping.columns),columns);
  assert.deepEqual(mapStockLotCostAuditRecord(fixture()),{
    legacy_sheet_row:2,correction_id:'COR-1',date_text:'2026-11-16T09:00Z',
    lot_id:'LOT-1',product_id:'PR-1',product_name:'তার',source:'PUR-1',
    old_purchase_price_text:'-0.00',new_purchase_price_text:'12.5',
    original_quantity_text:'20',remaining_quantity_text:'12.00',
    matched_historical_quantity_text:'8',affected_invoice_count_text:'2',
    historical_cogs_delta_text:'-17.250',reason:'  corrected  ',
    corrected_by:'রহিম',created_at_text:'2026-11-16T10:00Z'
  });
});

test('0011 contains an isolated immutable STRICT audit and no live ledger/stock foreign key',()=>{
  const sql=readFileSync(new URL('../migrations/0011_legacy_stock_lot_cost_corrections.sql',import.meta.url),'utf8');
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(sql);
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>r.name),['legacy_stock_lot_cost_corrections']);
    assert.equal(db.prepare("PRAGMA table_list('legacy_stock_lot_cost_corrections')").get().strict,1);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_list('legacy_stock_lot_cost_corrections')").all(),[]);
    assert.deepEqual(db.prepare("PRAGMA table_info('legacy_stock_lot_cost_corrections')").all().map(x=>x.name),[
      'row_id','legacy_sheet_row','correction_id','date_text','lot_id','product_id',
      'product_name','source','old_purchase_price_text','new_purchase_price_text',
      'original_quantity_text','remaining_quantity_text','matched_historical_quantity_text',
      'affected_invoice_count_text','historical_cogs_delta_text','reason','corrected_by','created_at_text'
    ]);
    const stmt=db.prepare('INSERT INTO legacy_stock_lot_cost_corrections(legacy_sheet_row,correction_id,lot_id,product_id) VALUES (?,?,?,?)');
    stmt.run(2,'COR-1','LOT-1','PR-1');
    assert.throws(()=>stmt.run(3,'COR-1','LOT-2','PR-1'),/unique/i);
    assert.throws(()=>stmt.run(2,'COR-2','LOT-2','PR-1'),/unique/i);
    assert.throws(()=>stmt.run(1,'COR-2','LOT-2','PR-1'),/check/i);
    assert.throws(()=>stmt.run(3,'','LOT-2','PR-1'),/check/i);
    assert.throws(()=>db.prepare("UPDATE legacy_stock_lot_cost_corrections SET reason='forged'").run(),/immutable/i);
    assert.throws(()=>db.prepare('DELETE FROM legacy_stock_lot_cost_corrections').run(),/immutable/i);
  }finally{db.close();}
});
