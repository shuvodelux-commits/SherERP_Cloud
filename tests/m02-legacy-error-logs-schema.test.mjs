import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {inventorySchema} from '../scripts/inventory-schema.mjs';
import {legacyErrorLogMapping,verifyLegacyErrorLogMapping,mapLegacyErrorLogRecord} from '../src/db/legacy-error-log-mapping.js';

const inventory=inventorySchema(readFileSync(new URL('../legacy/source/Config.gs',import.meta.url),'utf8'));
test('frozen LOGS group is three source fields, with no synthetic source Log ID',()=>{
  assert.deepEqual(inventory.tables.find(x=>x.sheetKey==='LOGS').columns,['Timestamp','Context','Message']);
  assert.equal(verifyLegacyErrorLogMapping(inventory),true);
  assert.deepEqual(legacyErrorLogMapping,{
    table:'legacy_error_logs',
    columns:{Timestamp:'timestamp_text',Context:'context',Message:'message'}
  });
  assert.deepEqual(mapLegacyErrorLogRecord({
    Timestamp:'2026-11-16T00:00:00.000Z',Context:'POS','Message':'  error বিস্তারিত  ',_rowIndex:2
  }),{
    timestamp_text:'2026-11-16T00:00:00.000Z',context:'POS',message:'  error বিস্তারিত  ',legacy_sheet_row:2
  });
  assert.throws(()=>mapLegacyErrorLogRecord({
    Timestamp:'',Context:'POS',Message:'oops',_rowIndex:2,Internal:'unsafe'
  }),/unexpected|invalid/i);
});

test('0006 creates only an independent STRICT diagnostic table with nonunique timestamps',()=>{
  const sql=readFileSync(new URL('../migrations/0006_legacy_error_logs.sql',import.meta.url),'utf8');
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(sql);
    const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(x=>x.name);
    assert.deepEqual(names,['legacy_error_logs']);
    assert.deepEqual(db.prepare("PRAGMA table_info('legacy_error_logs')").all().map(x=>x.name),
      ['row_id','legacy_sheet_row','timestamp_text','context','message']);
    assert.equal(db.prepare("PRAGMA table_list('legacy_error_logs')").get().strict,1);
    const insert=db.prepare('INSERT INTO legacy_error_logs (legacy_sheet_row,timestamp_text,context,message) VALUES (?,?,?,?)');
    insert.run(2,'2026-11-16T00:00:00Z','ERR','same');
    insert.run(3,'2026-11-16T00:00:00Z','ERR','same');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM legacy_error_logs').get().n,2);
    assert.throws(()=>insert.run(2,'','ERR','different'),/unique/i);
    assert.throws(()=>insert.run(1,'','ERR','invalid'),/check/i);
    assert.throws(()=>db.prepare("INSERT INTO legacy_error_logs (timestamp_text,context,message) VALUES (42,'ERR','wrong type')").run(),/constraint|datatype/i);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM legacy_error_logs").get().n,2);
  }finally{db.close();}
});
