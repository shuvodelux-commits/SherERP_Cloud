import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {importSourceInvoiceEditAuditWithD1} from '../../src/db/invoice-edit-audit-import.js';
import {summarizeM10InvoiceEditAudit} from '../../src/migration/m10-invoice-edit-audit-digest.js';

const inventory=JSON.parse(readFileSync(new URL('../../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-invoice-edit-audit-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-invoice-edit-audit-local-only');
let DB;
const source=()=>[
  {'Log ID':'IEL-001','Invoice ID':'INV-01','Edit Date':'2026-11-16T11:00Z',
    Reason:'  পরিবর্তন  ','Before Grand Total':'','After Grand Total':'',
    'Return ID':'SRT-01','Before Return Amount':12.5,'After Return Amount':'13.50',
    'Before Return Items JSON':' [{"unit":"Pcs","qty":1}] ',
    'After Return Items JSON':' [{"unit":"Pcs","qty":2}] ','Edited By':'মিনা',_rowIndex:2},
  {'Log ID':'IEL-002','Invoice ID':'INV-01','Edit Date':'2026-11-16T11:10Z',
    Reason:'  পরিবর্তন  ','Before Grand Total':'100.00','After Grand Total':99.5,
    'Return ID':'SRT-01','Before Return Amount':'13.50','After Return Amount':14,
    'Before Return Items JSON':' [{"unit":"Pcs","qty":2}] ',
    'After Return Items JSON':'[{"unit":"Pcs","qty":3}]','Edited By':'মিনা',_rowIndex:3}
];
const digest=rows=>summarizeM10InvoiceEditAudit({inventory,rows});
async function readStored(){
  const r=await DB.prepare('SELECT legacy_sheet_row,log_id,invoice_id,edit_date_text,reason,before_grand_total_text,after_grand_total_text,return_id,before_return_amount_text,after_return_amount_text,before_return_items_json,after_return_items_json,edited_by FROM legacy_invoice_edit_audit ORDER BY legacy_sheet_row').all();
  assert.equal(r.success,true);
  assert.ok(Array.isArray(r.results));
  return r.results.map(x=>({
    'Log ID':x.log_id,'Invoice ID':x.invoice_id,'Edit Date':x.edit_date_text,
    Reason:x.reason,'Before Grand Total':x.before_grand_total_text,
    'After Grand Total':x.after_grand_total_text,'Return ID':x.return_id,
    'Before Return Amount':x.before_return_amount_text,
    'After Return Amount':x.after_return_amount_text,
    'Before Return Items JSON':x.before_return_items_json,
    'After Return Items JSON':x.after_return_items_json,
    'Edited By':x.edited_by,_rowIndex:x.legacy_sheet_row
  }));
}
before(async()=>{await harness.listen();await worker.applyD1Migrations('DB');({DB}=await worker.getEnv());});
after(async()=>{await harness.close();});

test('source and persisted real local Workerd/D1 independently match original Log ID and full row hashes',async()=>{
  const actual=source(),copy=structuredClone(actual);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM legacy_invoice_edit_audit').first()).n,0);
  const imported=await importSourceInvoiceEditAuditWithD1({DB,sourceRows:actual});
  assert.deepEqual(imported,{sourceGroup:'INVOICE_EDIT_LOG',importedRows:2,reconciled:true});
  const stored=await readStored();
  assert.equal(stored[0]['Before Return Amount'],'12.5');
  assert.equal(stored[0]['After Return Amount'],'13.50');
  assert.equal(stored[1]['Before Grand Total'],'100.00');
  assert.equal(stored[1]['After Grand Total'],'99.5');
  assert.equal(stored[0]['Before Return Items JSON'],' [{"unit":"Pcs","qty":1}] ');
  assert.deepEqual(digest(stored),digest(actual));
  assert.deepEqual(actual,copy);
});

test('immutable D1 audit triggers reject UPDATE and DELETE and retain stored checksum',async()=>{
  const before=digest(await readStored());
  await assert.rejects(()=>DB.prepare("UPDATE legacy_invoice_edit_audit SET reason='tampered'").run(),/immutable|audit/i);
  await assert.rejects(()=>DB.prepare('DELETE FROM legacy_invoice_edit_audit').run(),/immutable|audit/i);
  assert.deepEqual(digest(await readStored()),before);
});

test('independent readback copy detects financial-text and JSON formatting drift with identical original ID hash',async()=>{
  const stored=await readStored(),base=digest(stored);
  for(const [index,column,value] of [
    [0,'Before Return Amount','12.50'],
    [1,'After Grand Total','99.50'],
    [0,'Before Return Items JSON','[{"unit":"Pcs","qty":1}]'],
    [1,'Reason','  өзгерում  ']
  ]){
    const changed=structuredClone(stored);changed[index][column]=value;
    const proof=digest(changed);
    assert.notEqual(proof.rowDigest,base.rowDigest,column);
    assert.equal(proof.idDigest,base.idDigest,column);
  }
});

test('original Log ID mismatch and independently truncated readback cannot match source evidence',async()=>{
  const stored=await readStored(),base=digest(stored);
  const changed=structuredClone(stored);
  changed[0]['Log ID']='IEL-REPLACED';
  assert.notEqual(digest(changed).idDigest,base.idDigest);
  assert.notEqual(digest(changed).rowDigest,base.rowDigest);
  const truncated=digest(stored.slice(0,1));
  assert.equal(truncated.rowCount,1);
  assert.notEqual(truncated.rowDigest,base.rowDigest);
  assert.notEqual(truncated.idDigest,base.idDigest);
});

test('one-shot D1 importer rejects changed replay and test Worker exposes no HTTP import or RPC',async()=>{
  const edited=source();edited[0].Reason='new reason';
  await assert.rejects(()=>importSourceInvoiceEditAuditWithD1({DB,sourceRows:edited}),/failed|fresh/i);
  assert.deepEqual(digest(await readStored()),digest(source()));
  for(const path of ['/api/rpc','/api/health','/__m10__/invoice-edit-import']){
    const res=await worker.fetch('http://synthetic.local'+path,{method:'POST',body:'{}'});
    assert.equal(res.status,404);
  }
});
