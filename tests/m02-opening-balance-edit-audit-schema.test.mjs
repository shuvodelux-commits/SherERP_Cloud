import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {inventorySchema} from '../scripts/inventory-schema.mjs';
import {
  openingBalanceEditAuditMapping,verifyOpeningBalanceEditAuditMapping,
  mapOpeningBalanceEditAuditRecord
} from '../src/db/opening-balance-edit-audit-mapping.js';

const fields=['Audit ID','Changed At','Entity Type','Entity ID','Entity Name',
  'Old Opening Balance','New Opening Balance','Delta','Current Due Before',
  'Current Due After','Reason','Changed By'];
const source=inventorySchema(readFileSync(new URL('../legacy/source/Config.gs',import.meta.url),'utf8'));
const entry=()=>({
  'Audit ID':'OBL-0001','Changed At':'2026-11-16T12:00:00Z','Entity Type':'CUSTOMER',
  'Entity ID':'C-001','Entity Name':'করিম','Old Opening Balance':'-150.00',
  'New Opening Balance':-100.5,Delta:49.5,'Current Due Before':'-90.00',
  'Current Due After':-40.5,Reason:'  আগের হিসাব সংশোধন  ',
  'Changed By':'স্টাফ',_rowIndex:2
});

test('frozen source header contract and exact original signed amounts, actors, and IDs',()=>{
  assert.deepEqual(source.tables.find(x=>x.sheetKey==='OPENING_BALANCE_EDIT_LOG')?.columns,fields);
  assert.equal(verifyOpeningBalanceEditAuditMapping(source),true);
  assert.equal(openingBalanceEditAuditMapping.table,'legacy_opening_balance_edit_audit');
  assert.deepEqual(Object.keys(openingBalanceEditAuditMapping.columns),fields);
  assert.deepEqual(mapOpeningBalanceEditAuditRecord(entry()),{
    legacy_sheet_row:2,audit_id:'OBL-0001',changed_at_text:'2026-11-16T12:00:00Z',
    entity_type:'CUSTOMER',entity_id:'C-001',entity_name:'করিম',
    old_opening_balance_text:'-150.00',new_opening_balance_text:'-100.5',
    delta_text:'49.5',current_due_before_text:'-90.00',
    current_due_after_text:'-40.5',reason:'  আগের হিসাব সংশোধন  ',
    changed_by:'স্টাফ'
  });
});

test('0010 creates independent immutable STRICT opening-balance audit with unique original ID and source row',()=>{
  const sql=readFileSync(new URL('../migrations/0010_legacy_opening_balance_edit_audit.sql',import.meta.url),'utf8');
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(sql);
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(x=>x.name),['legacy_opening_balance_edit_audit']);
    assert.equal(db.prepare("PRAGMA table_list('legacy_opening_balance_edit_audit')").get().strict,1);
    assert.deepEqual(db.prepare("PRAGMA table_info('legacy_opening_balance_edit_audit')").all().map(x=>x.name),[
      'row_id','legacy_sheet_row','audit_id','changed_at_text','entity_type','entity_id',
      'entity_name','old_opening_balance_text','new_opening_balance_text','delta_text',
      'current_due_before_text','current_due_after_text','reason','changed_by'
    ]);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_list('legacy_opening_balance_edit_audit')").all(),[]);
    const insert=db.prepare("INSERT INTO legacy_opening_balance_edit_audit(legacy_sheet_row,audit_id,entity_type,entity_id,old_opening_balance_text) VALUES(?,?,?,?,?)");
    insert.run(2,'OBL-1','CUSTOMER','C-1','-150.00');
    assert.equal(db.prepare("SELECT old_opening_balance_text FROM legacy_opening_balance_edit_audit").get().old_opening_balance_text,'-150.00');
    assert.throws(()=>insert.run(3,'OBL-1','SUPPLIER','S-1',''),/unique/i);
    assert.throws(()=>insert.run(2,'OBL-2','SUPPLIER','S-1',''),/unique/i);
    assert.throws(()=>insert.run(1,'OBL-2','SUPPLIER','S-1',''),/check/i);
    assert.throws(()=>insert.run(3,' ','SUPPLIER','S-1',''),/check/i);
    assert.throws(()=>db.prepare("UPDATE legacy_opening_balance_edit_audit SET reason='forged'").run(),/immutable|audit/i);
    assert.throws(()=>db.prepare("DELETE FROM legacy_opening_balance_edit_audit").run(),/immutable|audit/i);
  }finally{db.close();}
});
