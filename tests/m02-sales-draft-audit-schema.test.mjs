import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {inventorySchema} from '../scripts/inventory-schema.mjs';
import {salesDraftAuditMapping,verifySalesDraftAuditMapping,mapSalesDraftAuditRecord} from '../src/db/sales-draft-audit-mapping.js';

const columns=['Audit ID','Timestamp','Action','Draft ID','Draft No','Version',
  'Actor ID','Actor Name','Source Owner ID','Invoice ID','Note'];
const source=inventorySchema(readFileSync(new URL('../legacy/source/Config.gs',import.meta.url),'utf8'));
const sample=()=>({'Audit ID':'DA-001',Timestamp:'2026-11-16T10:15:00Z',Action:'POSTED',
  'Draft ID':'DRF-001','Draft No':'D-0001',Version:2,'Actor ID':'U-1',
  'Actor Name':'নাসির','Source Owner ID':'U-0','Invoice ID':'INV-001',
  Note:'  posted after retry  ',_rowIndex:2});

test('frozen 11-header SALES_DRAFT_AUDIT retains source identifiers, action, version and Bangla text',()=>{
  assert.deepEqual(source.tables.find(x=>x.sheetKey==='SALES_DRAFT_AUDIT')?.columns,columns);
  assert.equal(verifySalesDraftAuditMapping(source),true);
  assert.equal(salesDraftAuditMapping.table,'legacy_sales_draft_audit');
  assert.deepEqual(Object.keys(salesDraftAuditMapping.columns),columns);
  assert.deepEqual(mapSalesDraftAuditRecord(sample()),{
    legacy_sheet_row:2,audit_id:'DA-001',timestamp_text:'2026-11-16T10:15:00Z',
    action:'POSTED',draft_id:'DRF-001',draft_no:'D-0001',version_text:'2',
    actor_id:'U-1',actor_name:'নাসির',source_owner_id:'U-0',
    invoice_id:'INV-001',note:'  posted after retry  '
  });
});

test('0008 creates only an immutable independent sales-draft audit STRICT table',()=>{
  const sql=readFileSync(new URL('../migrations/0008_legacy_sales_draft_audit.sql',import.meta.url),'utf8');
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(sql);
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(x=>x.name),['legacy_sales_draft_audit']);
    assert.equal(db.prepare("PRAGMA table_list('legacy_sales_draft_audit')").get().strict,1);
    assert.deepEqual(db.prepare("PRAGMA table_info('legacy_sales_draft_audit')").all().map(x=>x.name),[
      'row_id','legacy_sheet_row','audit_id','timestamp_text','action','draft_id',
      'draft_no','version_text','actor_id','actor_name','source_owner_id','invoice_id','note'
    ]);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_list('legacy_sales_draft_audit')").all(),[]);
    const insert=db.prepare('INSERT INTO legacy_sales_draft_audit (legacy_sheet_row,audit_id,action,draft_id,draft_no,version_text) VALUES (?,?,?,?,?,?)');
    insert.run(2,'DA-1','POSTED','DRF-1','D-0001','2');
    insert.run(3,'DA-2','POST_CLEANUP_RETRY','DRF-1','D-0001','2');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM legacy_sales_draft_audit').get().n,2);
    assert.throws(()=>insert.run(4,'DA-1','CREATED','DRF-2','D-0002','1'),/unique/i);
    assert.throws(()=>insert.run(2,'DA-3','CREATED','DRF-2','D-0002','1'),/unique/i);
    assert.throws(()=>insert.run(1,'DA-3','CREATED','DRF-2','D-0002','1'),/check/i);
    assert.throws(()=>insert.run(4,'','CREATED','DRF-2','D-0002','1'),/check/i);
    assert.throws(()=>insert.run(4,'DA-3','WRONG','DRF-2','D-0002','1'),/check/i);
    assert.throws(()=>db.prepare("UPDATE legacy_sales_draft_audit SET note='forged'").run(),/immutable|audit/i);
    assert.throws(()=>db.prepare('DELETE FROM legacy_sales_draft_audit').run(),/immutable|audit/i);
  } finally {db.close();}
});
