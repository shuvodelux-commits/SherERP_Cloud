import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {inventorySchema} from '../scripts/inventory-schema.mjs';
import {invoiceEditAuditMapping,verifyInvoiceEditAuditMapping,mapInvoiceEditAuditRecord} from '../src/db/invoice-edit-audit-mapping.js';

const cols=['Log ID','Invoice ID','Edit Date','Reason','Before Grand Total','After Grand Total',
  'Return ID','Before Return Amount','After Return Amount','Before Return Items JSON',
  'After Return Items JSON','Edited By'];
const source=inventorySchema(readFileSync(new URL('../legacy/source/Config.gs',import.meta.url),'utf8'));
const sample=()=>({'Log ID':'IEL-1','Invoice ID':'INV-1','Edit Date':'2026-11-16T11:10:00Z',
  Reason:'  বিক্রয় সংশোধন  ','Before Grand Total':'100.00','After Grand Total':100.0,
  'Return ID':'SRT-1','Before Return Amount':12.5,'After Return Amount':'13.50',
  'Before Return Items JSON':' [ {"qty": 1} ] ','After Return Items JSON':'[{"qty":2}]',
  'Edited By':'কারিম',_rowIndex:2});

test('source-frozen 12-column invoice edit audit preserves financial textual and JSON evidence',()=>{
  assert.deepEqual(source.tables.find(x=>x.sheetKey==='INVOICE_EDIT_LOG')?.columns,cols);
  assert.equal(verifyInvoiceEditAuditMapping(source),true);
  assert.deepEqual(Object.keys(invoiceEditAuditMapping.columns),cols);
  assert.equal(invoiceEditAuditMapping.table,'legacy_invoice_edit_audit');
  assert.deepEqual(mapInvoiceEditAuditRecord(sample()),{
    legacy_sheet_row:2,log_id:'IEL-1',invoice_id:'INV-1',
    edit_date_text:'2026-11-16T11:10:00Z',reason:'  বিক্রয় সংশোধন  ',
    before_grand_total_text:'100.00',after_grand_total_text:'100',
    return_id:'SRT-1',before_return_amount_text:'12.5',
    after_return_amount_text:'13.50',
    before_return_items_json:' [ {"qty": 1} ] ',after_return_items_json:'[{"qty":2}]',
    edited_by:'কারিম'
  });
});

test('0009 creates only original-ID immutable STRICT invoice edit audit (no financial posting)',()=>{
  const sql=readFileSync(new URL('../migrations/0009_legacy_invoice_edit_audit.sql',import.meta.url),'utf8');
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(sql);
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(x=>x.name),['legacy_invoice_edit_audit']);
    assert.equal(db.prepare("PRAGMA table_list('legacy_invoice_edit_audit')").get().strict,1);
    assert.deepEqual(db.prepare("PRAGMA table_info('legacy_invoice_edit_audit')").all().map(x=>x.name),[
      'row_id','legacy_sheet_row','log_id','invoice_id','edit_date_text','reason',
      'before_grand_total_text','after_grand_total_text','return_id',
      'before_return_amount_text','after_return_amount_text',
      'before_return_items_json','after_return_items_json','edited_by'
    ]);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_list('legacy_invoice_edit_audit')").all(),[]);
    const insert=db.prepare('INSERT INTO legacy_invoice_edit_audit(legacy_sheet_row,log_id,invoice_id,before_return_items_json) VALUES (?,?,?,?)');
    insert.run(2,'IEL-1','INV-1',' [ 1, 2 ] ');
    insert.run(3,'IEL-2','INV-1',' [ 1, 2 ] ');
    assert.equal(db.prepare("SELECT before_return_items_json FROM legacy_invoice_edit_audit WHERE log_id='IEL-1'").get().before_return_items_json,' [ 1, 2 ] ');
    assert.throws(()=>insert.run(4,'IEL-1','INV-1',''),/unique/i);
    assert.throws(()=>insert.run(2,'IEL-3','INV-1',''),/unique/i);
    assert.throws(()=>insert.run(1,'IEL-3','INV-1',''),/check/i);
    assert.throws(()=>insert.run(4,'  ','INV-1',''),/check/i);
    assert.throws(()=>db.prepare("UPDATE legacy_invoice_edit_audit SET reason='forged'").run(),/immutable|audit/i);
    assert.throws(()=>db.prepare('DELETE FROM legacy_invoice_edit_audit').run(),/immutable|audit/i);
  }finally{db.close();}
});
