import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {importSourceSalesDraftAuditWithD1}
  from '../../src/db/sales-draft-audit-import.js';
import {createSalesDraftAuditReadAdapter}
  from '../../src/db/sales-draft-audit-read.js';
import publicWorker from '../../src/index.js';

const harness=createTestHarness({workers:[{
  configPath:'./wrangler.m02-sales-draft-audit-test.jsonc'
}]});
const worker=harness.getWorker('shererp-m02-sales-draft-audit-local-only');
const snapshot=()=>[
  {'Audit ID':'AUD-1',Timestamp:'2026-11-17T10:00Z',Action:'CREATED',
    'Draft ID':'DR-1','Draft No':'D-0001',Version:1,
    'Actor ID':'U-1','Actor Name':'মিতা','Source Owner ID':'U-1',
    'Invoice ID':'',Note:'',_rowIndex:2},
  {'Audit ID':'AUD-2',Timestamp:'2026-11-17T10:10Z',Action:'POST_CLEANUP_RETRY',
    'Draft ID':'DR-1','Draft No':'D-0001',Version:'02',
    'Actor ID':'U-1','Actor Name':'মিতা','Source Owner ID':'U-1',
    'Invoice ID':'INV-1',Note:'  পুনরায়  ',_rowIndex:3}
];
const expected=()=>snapshot().map((row,index)=>({
  ...row,Version:index===0?'1':'02'
}));
const sqlText='SELECT legacy_sheet_row,audit_id,timestamp_text,action,draft_id,draft_no,version_text,actor_id,actor_name,source_owner_id,invoice_id,note FROM legacy_sales_draft_audit ORDER BY legacy_sheet_row';
let DB;
const adapter=()=>createSalesDraftAuditReadAdapter({DB});
const count=async()=>(await DB.prepare(
  'SELECT COUNT(*) AS n FROM legacy_sales_draft_audit'
).first()).n;

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  assert.deepEqual(await importSourceSalesDraftAuditWithD1({
    DB,sourceRows:snapshot()
  }),{sourceGroup:'SALES_DRAFT_AUDIT',importedRows:2,reconciled:true});
});
after(async()=>harness.close());

test('real local Workerd D1 M02 import to M03 private source reader retains complete eleven-column evidence',async()=>{
  const a=adapter();
  assert.deepEqual(await a.getSheetHeaders_('SALES_DRAFT_AUDIT'),[
    'Audit ID','Timestamp','Action','Draft ID','Draft No','Version',
    'Actor ID','Actor Name','Source Owner ID','Invoice ID','Note'
  ]);
  const rows=await a.getAllRows_('SALES_DRAFT_AUDIT');
  assert.deepEqual(rows,expected());
  assert.equal(rows[0].Version,'1','M02 normalizes numeric source Version into descriptive TEXT');
  assert.equal(rows[1].Version,'02','source Version string leading zeros survive');
  assert.equal(rows[1].Note,'  পুনরায়  ');
  assert.equal(rows[1]['Actor Name'],'মিতা');
  assert.deepEqual(rows.map(row=>row._rowIndex),[2,3]);
  assert(rows.every(row=>!Object.hasOwn(row,'row_id')));
  assert.equal(await count(),2);
});

test('real local D1 source helpers retain repeated Draft Nos and exact first physical source match',async()=>{
  const a=adapter();
  assert.deepEqual(await a.findRows_('SALES_DRAFT_AUDIT','Draft ID','DR-1'),expected());
  assert.deepEqual(await a.findRows_('SALES_DRAFT_AUDIT','Draft No','D-0001'),expected());
  assert.deepEqual(await a.findFirstRow_('SALES_DRAFT_AUDIT','Draft No','D-0001'),expected()[0]);
  assert.deepEqual(await a.findRow_('SALES_DRAFT_AUDIT','Audit ID','AUD-2'),
    {row:expected()[1],rowIndex:3});
  assert.equal(await a.findRowIndex_('SALES_DRAFT_AUDIT','Audit ID','AUD-2'),3);
  assert.equal(await a.findRowIndex_('SALES_DRAFT_AUDIT','Audit ID','absent'),-1);
  assert.equal(await a.findFirstRow_('SALES_DRAFT_AUDIT','Version','2'),null);
});

test('read-only M03 adapter does not mutate D1 history; actual D1 immutability triggers reject updates and deletes',async()=>{
  const before=(await DB.prepare(sqlText).all()).results;
  await adapter().getAllRows_('SALES_DRAFT_AUDIT');
  await adapter().findRows_('SALES_DRAFT_AUDIT','Draft No','D-0001');
  assert.deepEqual((await DB.prepare(sqlText).all()).results,before);
  await assert.rejects(()=>DB.prepare(
    "UPDATE legacy_sales_draft_audit SET note='tampered' WHERE audit_id='AUD-1'"
  ).run(),/immutable|audit/i);
  await assert.rejects(()=>DB.prepare(
    "DELETE FROM legacy_sales_draft_audit WHERE audit_id='AUD-1'"
  ).run(),/immutable|audit/i);
  assert.equal(await count(),2);
});

test('private historical archive cannot be invoked through fixture Worker or public DB-free RPC',async()=>{
  for(const path of ['/api/rpc','/__m03_test__/sales-draft-audit',
    '/__m02_test__/sales-draft-audit','/api/health']){
    const response=await worker.fetch('http://local-draft-audit.test'+path,{
      method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
    });
    assert.equal(response.status,404,path);
  }
  const response=await publicWorker.fetch(new Request('https://public.invalid/api/rpc',{
    method:'POST',headers:{Origin:'https://public.invalid','Content-Type':'application/json'},
    body:JSON.stringify({fnName:'getAllRows_',args:['SALES_DRAFT_AUDIT']})
  }),{DB});
  assert.equal(response.status,501);
  assert.deepEqual(await response.json(),{
    success:false,message:'RPC method not migrated'
  });
  const preview=JSON.parse(readFileSync(new URL('../../wrangler.preview.jsonc',import.meta.url),'utf8'));
  assert.equal(preview.d1_databases,undefined);
  assert.equal(readFileSync(new URL('../../src/index.js',import.meta.url),'utf8')
    .includes('sales-draft-audit-read'),false);
  assert.equal(readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8')
    .includes('SALES_DRAFT_AUDIT'),false);
});

test('gapped old physical row is blocked instead of associating history with the wrong Draft No',async()=>{
  await DB.prepare(
    'INSERT INTO legacy_sales_draft_audit(legacy_sheet_row,audit_id,action,draft_id,draft_no,version_text) VALUES(?,?,?,?,?,?)'
  ).bind(8,'AUD-SYNTHETIC-GAP','CREATED','DR-1','D-0001','3').run();
  await assert.rejects(()=>adapter().getAllRows_('SALES_DRAFT_AUDIT'),
    /invalid|archive|source|row/i);
  await assert.rejects(()=>adapter().findRowIndex_('SALES_DRAFT_AUDIT','Audit ID','AUD-1'),
    /invalid|archive|source|row/i);
  assert.equal(await count(),3);
});
