import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {importSourceInvoiceEditAuditWithD1} from '../../src/db/invoice-edit-audit-import.js';
const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-invoice-edit-audit-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-invoice-edit-audit-local-only');
let DB;
const sample=()=>[
  {'Log ID':'IEL-1','Invoice ID':'INV-1','Edit Date':'2026-11-16T11:00Z',
    Reason:'  পরিবর্তন  ','Before Grand Total':'','After Grand Total':'','Return ID':'SRT-1',
    'Before Return Amount':12.5,'After Return Amount':'13.50',
    'Before Return Items JSON':' [1, 2] ','After Return Items JSON':' [2, 3] ','Edited By':'মিনা',_rowIndex:2},
  {'Log ID':'IEL-2','Invoice ID':'INV-1','Edit Date':'2026-11-16T11:10Z',
    Reason:'  পরিবর্তন  ','Before Grand Total':'100.00','After Grand Total':99.5,'Return ID':'SRT-1',
    'Before Return Amount':'13.50','After Return Amount':14,
    'Before Return Items JSON':' [2, 3] ','After Return Items JSON':' [3, 4] ','Edited By':'মিনা',_rowIndex:3}
];
const count=async()=>(await DB.prepare('SELECT COUNT(*) AS n FROM legacy_invoice_edit_audit').first()).n;
const read=async()=>(await DB.prepare('SELECT legacy_sheet_row,log_id,invoice_id,edit_date_text,reason,before_grand_total_text,after_grand_total_text,return_id,before_return_amount_text,after_return_amount_text,before_return_items_json,after_return_items_json,edited_by FROM legacy_invoice_edit_audit ORDER BY legacy_sheet_row').all()).results;

before(async()=>{await harness.listen();await worker.applyD1Migrations('DB');({DB}=await worker.getEnv());});
after(async()=>{await harness.close();});

test('malformed source is denied without writing any real local D1 rows',async()=>{
  const s=sample();
  for(const rows of [[],s.slice().reverse(),[s[0],{...s[1],'Log ID':'IEL-1'}],
    [{...s[0],'Before Return Amount':Infinity},s[1]]]){
    await assert.rejects(()=>importSourceInvoiceEditAuditWithD1({DB,sourceRows:rows}),/source|invalid|duplicate/i);
    assert.equal(await count(),0);
  }
});

test('late second-row SQL insert failure aborts the entire D1 batch',async()=>{
  await DB.prepare("CREATE TRIGGER invoice_edit_late_fail BEFORE INSERT ON legacy_invoice_edit_audit WHEN NEW.log_id='IEL-2' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END").run();
  try{
    await assert.rejects(()=>importSourceInvoiceEditAuditWithD1({DB,sourceRows:sample()}),/D1|failed/i);
    assert.equal(await count(),0);
  }finally{await DB.prepare('DROP TRIGGER invoice_edit_late_fail').run();}
});

test('racing importers have one winner and preserve exact source JSON and amount text',async()=>{
  const s=sample(),original=JSON.stringify(s);
  const pair=await Promise.allSettled([
    importSourceInvoiceEditAuditWithD1({DB,sourceRows:s}),
    importSourceInvoiceEditAuditWithD1({DB,sourceRows:sample()})
  ]);
  assert.deepEqual(pair.map(x=>x.status).sort(),['fulfilled','rejected']);
  assert.deepEqual(pair.find(x=>x.status==='fulfilled').value,{
    sourceGroup:'INVOICE_EDIT_LOG',importedRows:2,reconciled:true
  });
  assert.equal(JSON.stringify(s),original);
  const rows=await read();
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(x=>x.log_id),['IEL-1','IEL-2']);
  assert.deepEqual(rows.map(x=>x.before_grand_total_text),['','100.00']);
  assert.deepEqual(rows.map(x=>x.after_return_amount_text),['13.50','14']);
  assert.deepEqual(rows.map(x=>x.before_return_items_json),[' [1, 2] ',' [2, 3] ']);
  assert.equal(rows[0].reason,'  পরিবর্তন  ');
});

test('replay, edited snapshot, SQL UPDATE and SQL DELETE are all forbidden',async()=>{
  const previous=await read();
  await assert.rejects(()=>importSourceInvoiceEditAuditWithD1({DB,sourceRows:sample()}),/D1|failed/i);
  const changed=sample();changed[1]['After Return Amount']='9999';
  await assert.rejects(()=>importSourceInvoiceEditAuditWithD1({DB,sourceRows:changed}),/D1|failed/i);
  await assert.rejects(()=>DB.prepare("UPDATE legacy_invoice_edit_audit SET reason='forged'").run(),/immutable|audit/i);
  await assert.rejects(()=>DB.prepare('DELETE FROM legacy_invoice_edit_audit').run(),/immutable|audit/i);
  assert.deepEqual(await read(),previous);
});

test('isolated Worker serves no public import, RPC or health routes',async()=>{
  for(const path of ['/api/rpc','/__m02_test__/invoice-edit-import','/api/health']){
    const response=await worker.fetch('http://synthetic.local'+path,{method:'POST',body:'{}'});
    assert.equal(response.status,404);
  }
});
