import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {importSourceInvoiceEditAuditWithD1}
  from '../../src/db/invoice-edit-audit-import.js';
import {createInvoiceEditAuditReadAdapter}
  from '../../src/db/invoice-edit-audit-read.js';
import publicWorker from '../../src/index.js';

const harness=createTestHarness({workers:[{
  configPath:'./wrangler.m02-invoice-edit-audit-test.jsonc'
}]});
const worker=harness.getWorker('shererp-m02-invoice-edit-audit-local-only');
const snapshot=()=>[
  {'Log ID':'IEL-1','Invoice ID':'INV-1','Edit Date':'2026-11-16T11:00Z',
   Reason:'  পরিবর্তন  ','Before Grand Total':'','After Grand Total':'','Return ID':'SRT-1',
   'Before Return Amount':12.5,'After Return Amount':'13.50',
   'Before Return Items JSON':' [1, 2] ','After Return Items JSON':' [2, 3] ','Edited By':'মিনা',_rowIndex:2},
  {'Log ID':'IEL-2','Invoice ID':'INV-1','Edit Date':'2026-11-16T11:10Z',
   Reason:'  পরিবর্তন  ','Before Grand Total':'100.00','After Grand Total':99.5,'Return ID':'SRT-1',
   'Before Return Amount':'13.50','After Return Amount':14,
   'Before Return Items JSON':' [2, 3] ','After Return Items JSON':' [3, 4] ','Edited By':'মিনা',_rowIndex:3}
];
const expected=()=>snapshot().map((row,i)=>({
  ...row,
  ...(i===0
    ? {'Before Return Amount':'12.5'}
    : {'After Grand Total':'99.5','After Return Amount':'14'})
}));
let DB;
const read=()=>createInvoiceEditAuditReadAdapter({DB});
const count=async()=> (await DB.prepare(
  'SELECT COUNT(*) AS n FROM legacy_invoice_edit_audit'
).first()).n;

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  assert.deepEqual(await importSourceInvoiceEditAuditWithD1({
    DB,sourceRows:snapshot()
  }),{sourceGroup:'INVOICE_EDIT_LOG',importedRows:2,reconciled:true});
});
after(async()=>harness.close());

test('actual local Workerd D1 import→M03 source-shaped audit read preserves the original log and snapshots',async()=>{
  const x=read();
  assert.deepEqual(await x.getSheetHeaders_('INVOICE_EDIT_LOG'),[
    'Log ID','Invoice ID','Edit Date','Reason','Before Grand Total','After Grand Total',
    'Return ID','Before Return Amount','After Return Amount','Before Return Items JSON',
    'After Return Items JSON','Edited By'
  ]);
  const rows=await x.getAllRows_('INVOICE_EDIT_LOG');
  assert.deepEqual(rows,expected());
  assert.deepEqual(rows.map(r=>r._rowIndex),[2,3]);
  assert.equal(rows[0]['Before Return Items JSON'],' [1, 2] ');
  assert.equal(rows[0]['Before Return Amount'],'12.5',
    'M02 archival normalization stores descriptive TEXT for numeric source amount');
  assert.equal(rows[1]['Before Grand Total'],'100.00');
  assert.equal(rows[1]['After Grand Total'],'99.5');
  assert.equal(rows[1]['Edited By'],'মিনা');
  assert.equal(rows[1].then,undefined);
  assert.equal(await count(),2);
});

test('real D1 find helpers return all duplicate invoice edits and the first original physical row',async()=>{
  const x=read();
  assert.deepEqual(await x.findRows_('INVOICE_EDIT_LOG','Invoice ID','INV-1'),expected());
  assert.deepEqual(await x.findRows_('INVOICE_EDIT_LOG','Return ID','SRT-1'),expected());
  assert.deepEqual(await x.findFirstRow_('INVOICE_EDIT_LOG','Invoice ID','INV-1'),expected()[0]);
  assert.deepEqual(await x.findRow_('INVOICE_EDIT_LOG','Log ID','IEL-2'),{
    row:expected()[1],rowIndex:3
  });
  assert.equal(await x.findRowIndex_('INVOICE_EDIT_LOG','Log ID','IEL-2'),3);
  assert.equal(await x.findRowIndex_('INVOICE_EDIT_LOG','Log ID','absent'),-1);
  assert.equal(await x.findFirstRow_('INVOICE_EDIT_LOG','Reason','পরিবর্তন'),null);
});

test('reader is read-only; D1 immutable historical UPDATE/DELETE triggers protect existing evidence',async()=>{
  const before=(await DB.prepare('SELECT * FROM legacy_invoice_edit_audit ORDER BY legacy_sheet_row').all()).results;
  await read().getAllRows_('INVOICE_EDIT_LOG');
  await read().findRows_('INVOICE_EDIT_LOG','Invoice ID','INV-1');
  const after=(await DB.prepare('SELECT * FROM legacy_invoice_edit_audit ORDER BY legacy_sheet_row').all()).results;
  assert.deepEqual(after,before);
  await assert.rejects(()=>DB.prepare(
    "UPDATE legacy_invoice_edit_audit SET reason='tampered' WHERE log_id='IEL-1'"
  ).run(),/immutable|audit/i);
  await assert.rejects(()=>DB.prepare(
    "DELETE FROM legacy_invoice_edit_audit WHERE log_id='IEL-1'"
  ).run(),/immutable|audit/i);
  assert.equal(await count(),2);
});

test('no public Worker route or local import route exposes internal audit data',async()=>{
  for(const path of ['/api/rpc','/__m03_test__/invoice-edit-read','/__m02_test__/invoice-edit-import','/api/health']){
    const response=await worker.fetch('http://m03-invoice-audit.local'+path,{
      method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
    });
    assert.equal(response.status,404,path);
  }
  const response=await publicWorker.fetch(new Request('https://erp.invalid/api/rpc',{
    method:'POST',headers:{Origin:'https://erp.invalid','Content-Type':'application/json'},
    body:JSON.stringify({fnName:'getAllRows_',args:['INVOICE_EDIT_LOG']})
  }),{DB});
  assert.equal(response.status,501);
  assert.deepEqual(await response.json(),{success:false,message:'RPC method not migrated'});
  const preview=JSON.parse(readFileSync(
    new URL('../../wrangler.preview.jsonc',import.meta.url),'utf8'));
  const testConfig=JSON.parse(readFileSync(
    new URL('../../wrangler.m02-invoice-edit-audit-test.jsonc',import.meta.url),'utf8'));
  assert.equal(preview.d1_databases,undefined);
  assert.equal(testConfig.workers_dev,false);
  assert.equal(testConfig.routes,undefined);
  const live=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8');
  const registry=readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  assert.equal(live.includes('invoice-edit-audit-read'),false);
  assert.equal(registry.includes('INVOICE_EDIT_LOG'),false);
});

test('synthetic new gap in immutable append-only audit is detected rather than returning the wrong row',async()=>{
  const insert=DB.prepare(
    'INSERT INTO legacy_invoice_edit_audit(legacy_sheet_row,log_id,invoice_id,edit_date_text,reason) VALUES(?,?,?,?,?)'
  );
  await insert.bind(8,'IEL-SYNTHETIC-GAP','INV-1','2026-11-16T11:30Z','synthetic test only').run();
  await assert.rejects(()=>read().getAllRows_('INVOICE_EDIT_LOG'),/source|physical|row|archive/i);
  await assert.rejects(()=>read().findRowIndex_('INVOICE_EDIT_LOG','Log ID','IEL-1'),/source|physical|row|archive/i);
  assert.equal(await count(),3);
});
