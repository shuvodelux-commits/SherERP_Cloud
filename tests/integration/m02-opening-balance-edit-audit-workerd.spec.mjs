import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {importSourceOpeningBalanceEditAuditWithD1} from '../../src/db/opening-balance-edit-audit-import.js';
const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-opening-balance-edit-audit-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-opening-balance-edit-audit-local-only');
let DB;
const source=()=>[
  {'Audit ID':'OBL-1','Changed At':'2026-11-16T12:00Z','Entity Type':'CUSTOMER',
    'Entity ID':'C-1','Entity Name':'করিম','Old Opening Balance':'-150.00',
    'New Opening Balance':-100.5,Delta:49.5,'Current Due Before':'-90.00',
    'Current Due After':-40.5,Reason:' সংশোধন ','Changed By':'শুভ',_rowIndex:2},
  {'Audit ID':'OBL-2','Changed At':'2026-11-16T12:05Z','Entity Type':'SUPPLIER',
    'Entity ID':'S-1','Entity Name':'রহিম','Old Opening Balance':0,
    'New Opening Balance':'-0.00',Delta:'-0.00','Current Due Before':'',
    'Current Due After':'-0.00',Reason:' সংশোধন ','Changed By':'শুভ',_rowIndex:3}
];
const count=async()=>(await DB.prepare('SELECT COUNT(*) AS n FROM legacy_opening_balance_edit_audit').first()).n;
const read=async()=>(await DB.prepare('SELECT legacy_sheet_row,audit_id,changed_at_text,entity_type,entity_id,entity_name,old_opening_balance_text,new_opening_balance_text,delta_text,current_due_before_text,current_due_after_text,reason,changed_by FROM legacy_opening_balance_edit_audit ORDER BY legacy_sheet_row').all()).results;
before(async()=>{await harness.listen();await worker.applyD1Migrations('DB');({DB}=await worker.getEnv());});
after(async()=>{await harness.close();});

test('preflight rejects invalid source before real Workerd D1 writes',async()=>{
  const s=source();
  for(const rows of [[],s.slice().reverse(),[s[0],{...s[1],'Audit ID':'OBL-1'}],
    [{...s[0],'Delta':Infinity},s[1]]]){
    await assert.rejects(()=>importSourceOpeningBalanceEditAuditWithD1({DB,sourceRows:rows}),/source|invalid|duplicate/i);
    assert.equal(await count(),0);
  }
});
test('second-row SQL failure rolls back the complete local D1 audit batch',async()=>{
  await DB.prepare("CREATE TRIGGER opening_balance_late_fail BEFORE INSERT ON legacy_opening_balance_edit_audit WHEN NEW.audit_id='OBL-2' BEGIN SELECT RAISE(ABORT,'late synthetic error'); END").run();
  try{
    await assert.rejects(()=>importSourceOpeningBalanceEditAuditWithD1({DB,sourceRows:source()}),/D1|failed/i);
    assert.equal(await count(),0);
  }finally{await DB.prepare('DROP TRIGGER opening_balance_late_fail').run();}
});
test('only one concurrent import succeeds with exact historical signed amounts and source identity',async()=>{
  const s=source(),original=JSON.stringify(s);
  const outcomes=await Promise.allSettled([
    importSourceOpeningBalanceEditAuditWithD1({DB,sourceRows:s}),
    importSourceOpeningBalanceEditAuditWithD1({DB,sourceRows:source()})
  ]);
  assert.deepEqual(outcomes.map(x=>x.status).sort(),['fulfilled','rejected']);
  assert.deepEqual(outcomes.find(x=>x.status==='fulfilled').value,
    {sourceGroup:'OPENING_BALANCE_EDIT_LOG',importedRows:2,reconciled:true});
  assert.equal(JSON.stringify(s),original);
  const rows=await read();
  assert.deepEqual(rows.map(x=>x.audit_id),['OBL-1','OBL-2']);
  assert.deepEqual(rows.map(x=>x.old_opening_balance_text),['-150.00','0']);
  assert.deepEqual(rows.map(x=>x.new_opening_balance_text),['-100.5','-0.00']);
  assert.deepEqual(rows.map(x=>x.current_due_after_text),['-40.5','-0.00']);
  assert.equal(rows[0].reason,' সংশোধন ');
});
test('replay and SQL mutations cannot change an immutable historical record',async()=>{
  const before=await read();
  await assert.rejects(()=>importSourceOpeningBalanceEditAuditWithD1({DB,sourceRows:source()}),/D1|failed/i);
  const edited=source();edited[0]['Delta']='9999';
  await assert.rejects(()=>importSourceOpeningBalanceEditAuditWithD1({DB,sourceRows:edited}),/D1|failed/i);
  await assert.rejects(()=>DB.prepare("UPDATE legacy_opening_balance_edit_audit SET delta_text='1'").run(),/immutable|audit/i);
  await assert.rejects(()=>DB.prepare('DELETE FROM legacy_opening_balance_edit_audit').run(),/immutable|audit/i);
  assert.deepEqual(await read(),before);
});
test('synthetic test Worker provides no public import, RPC or health entry points',async()=>{
  for(const path of ['/api/rpc','/__m02_test__/opening-balance','/api/health']){
    const response=await worker.fetch('http://synthetic.local'+path,{method:'POST',body:'{}'});
    assert.equal(response.status,404);
  }
});
