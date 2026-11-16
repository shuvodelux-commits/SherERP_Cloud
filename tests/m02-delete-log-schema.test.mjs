import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {inventorySchema} from '../scripts/inventory-schema.mjs';
import {deleteLogMapping,verifyDeleteLogMapping,mapDeleteLogRecord} from '../src/db/delete-log-mapping.js';

const cols=['Log ID','Date','Time','Module','Record ID','Invoice No','Reason','Deleted By','Deleted By Mobile'];
const inventory=inventorySchema(readFileSync(new URL('../legacy/source/Config.gs',import.meta.url),'utf8'));
test('DELETE_LOG fixed source contract preserves nine fields and zero-prefixed phone text',()=>{
  assert.deepEqual(inventory.tables.find(x=>x.sheetKey==='DELETE_LOG')?.columns,cols);
  assert.equal(verifyDeleteLogMapping(inventory),true);
  assert.deepEqual(deleteLogMapping,{table:'legacy_delete_log',columns:{
    'Log ID':'log_id',Date:'date_text',Time:'time_text',Module:'module',
    'Record ID':'record_id','Invoice No':'invoice_no',Reason:'reason',
    'Deleted By':'deleted_by','Deleted By Mobile':'deleted_by_mobile'
  }});
  assert.deepEqual(mapDeleteLogRecord({
    'Log ID':'DEL-00001',Date:'2026-11-15',Time:'12:30:01',Module:'SALES',
    'Record ID':'INV-00001','Invoice No':'INV-00001',Reason:'  ভুল বিক্রয়  ',
    'Deleted By':'STAFF-1','Deleted By Mobile':'01712345678',_rowIndex:2
  }),{
    legacy_sheet_row:2,log_id:'DEL-00001',date_text:'2026-11-15',time_text:'12:30:01',
    module:'SALES',record_id:'INV-00001',invoice_no:'INV-00001',
    reason:'  ভুল বিক্রয়  ',deleted_by:'STAFF-1',deleted_by_mobile:'01712345678'
  });
});
test('0007 is independent STRICT append-only legacy audit history; no accounting schema',()=>{
  const sql=readFileSync(new URL('../migrations/0007_legacy_delete_log.sql',import.meta.url),'utf8');
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(sql);
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(x=>x.name),['legacy_delete_log']);
    assert.equal(db.prepare("PRAGMA table_list('legacy_delete_log')").get().strict,1);
    assert.deepEqual(db.prepare("PRAGMA table_info('legacy_delete_log')").all().map(x=>x.name),[
      'row_id','legacy_sheet_row','log_id','date_text','time_text','module','record_id','invoice_no','reason','deleted_by','deleted_by_mobile'
    ]);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_list('legacy_delete_log')").all(),[]);
    const st=db.prepare('INSERT INTO legacy_delete_log(legacy_sheet_row,log_id,deleted_by_mobile) VALUES(?,?,?)');
    st.run(2,'DEL-1','01712345678');
    assert.equal(db.prepare("SELECT deleted_by_mobile FROM legacy_delete_log WHERE log_id='DEL-1'").get().deleted_by_mobile,'01712345678');
    assert.throws(()=>st.run(3,'DEL-1',''),/unique/i);
    assert.throws(()=>st.run(2,'DEL-2',''),/unique/i);
    assert.throws(()=>st.run(1,'DEL-2',''),/check/i);
    assert.throws(()=>st.run(4,'',''),/check/i);
    assert.throws(()=>db.prepare("UPDATE legacy_delete_log SET reason='changed'").run(),/immutable|audit|forbidden/i);
    assert.throws(()=>db.prepare("DELETE FROM legacy_delete_log").run(),/immutable|audit|forbidden/i);
  }finally{db.close();}
});
