import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {importSourceSalesDraftAuditWithD1} from '../../src/db/sales-draft-audit-import.js';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-sales-draft-audit-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-sales-draft-audit-local-only');
let DB;
const sample=()=>[
  {'Audit ID':'AUD-1',Timestamp:'2026-11-16T10:00Z',Action:'CREATED',
    'Draft ID':'DR-1','Draft No':'D-0001',Version:1,'Actor ID':'U-1',
    'Actor Name':'শুভ','Source Owner ID':'U-1','Invoice ID':'',Note:'',_rowIndex:2},
  {'Audit ID':'AUD-2',Timestamp:'2026-11-16T10:01Z',Action:'POST_CLEANUP_RETRY',
    'Draft ID':'DR-1','Draft No':'D-0001',Version:'02','Actor ID':'U-1',
    'Actor Name':'শুভ','Source Owner ID':'U-1','Invoice ID':'INV-1',Note:'  retry  ',_rowIndex:3}
];
const count=async()=>(await DB.prepare('SELECT COUNT(*) AS n FROM legacy_sales_draft_audit').first()).n;
const read=async()=>(await DB.prepare('SELECT legacy_sheet_row,audit_id,timestamp_text,action,draft_id,draft_no,version_text,actor_id,actor_name,source_owner_id,invoice_id,note FROM legacy_sales_draft_audit ORDER BY legacy_sheet_row').all()).results;
before(async()=>{await harness.listen();await worker.applyD1Migrations('DB');({DB}=await worker.getEnv());});
after(async()=>{await harness.close();});

test('whole-source preflight fails before touching real local D1',async()=>{
  const s=sample();
  for(const rows of [[],s.slice().reverse(),[s[0],{...s[1],'Audit ID':s[0]['Audit ID']}],
    [{...s[0],Action:'WRONG'},s[1]]]){
    await assert.rejects(()=>importSourceSalesDraftAuditWithD1({DB,sourceRows:rows}),/source|invalid|duplicate/i);
    assert.equal(await count(),0);
  }
});

test('injected second-row D1 failure rolls back the entire draft audit',async()=>{
  await DB.prepare("CREATE TRIGGER draft_audit_injected_failure BEFORE INSERT ON legacy_sales_draft_audit WHEN NEW.audit_id='AUD-2' BEGIN SELECT RAISE(ABORT,'late failure'); END").run();
  try{
    await assert.rejects(()=>importSourceSalesDraftAuditWithD1({DB,sourceRows:sample()}),/D1|failed/i);
    assert.equal(await count(),0);
  }finally{await DB.prepare('DROP TRIGGER draft_audit_injected_failure').run();}
});

test('only one concurrent snapshot import wins, preserving all audit fields and version text',async()=>{
  const s=sample(),original=JSON.stringify(s);
  const result=await Promise.allSettled([
    importSourceSalesDraftAuditWithD1({DB,sourceRows:s}),
    importSourceSalesDraftAuditWithD1({DB,sourceRows:sample()})
  ]);
  assert.deepEqual(result.map(x=>x.status).sort(),['fulfilled','rejected']);
  assert.deepEqual(result.find(x=>x.status==='fulfilled').value,{sourceGroup:'SALES_DRAFT_AUDIT',importedRows:2,reconciled:true});
  assert.equal(JSON.stringify(s),original);
  assert.deepEqual(await read(),[
    {legacy_sheet_row:2,audit_id:'AUD-1',timestamp_text:'2026-11-16T10:00Z',action:'CREATED',
      draft_id:'DR-1',draft_no:'D-0001',version_text:'1',actor_id:'U-1',
      actor_name:'শুভ',source_owner_id:'U-1',invoice_id:'',note:''},
    {legacy_sheet_row:3,audit_id:'AUD-2',timestamp_text:'2026-11-16T10:01Z',action:'POST_CLEANUP_RETRY',
      draft_id:'DR-1',draft_no:'D-0001',version_text:'02',actor_id:'U-1',
      actor_name:'শুভ',source_owner_id:'U-1',invoice_id:'INV-1',note:'  retry  '}
  ]);
});

test('replay, changed snapshot, SQL UPDATE and SQL DELETE cannot rewrite history',async()=>{
  const before=await read();
  await assert.rejects(()=>importSourceSalesDraftAuditWithD1({DB,sourceRows:sample()}),/D1|failed/i);
  const s=sample();s[0].Note='forged';
  await assert.rejects(()=>importSourceSalesDraftAuditWithD1({DB,sourceRows:s}),/D1|failed/i);
  await assert.rejects(()=>DB.prepare("UPDATE legacy_sales_draft_audit SET note='changed'").run(),/immutable|audit/i);
  await assert.rejects(()=>DB.prepare('DELETE FROM legacy_sales_draft_audit').run(),/immutable|audit/i);
  assert.deepEqual(await read(),before);
});

test('no source import, public RPC or health route is exposed in test Worker',async()=>{
  for(const p of ['/api/rpc','/__m02_test__/sales-draft-audit','/api/health']){
    const response=await worker.fetch('http://synthetic.local'+p,{method:'POST',body:'{}'});
    assert.equal(response.status,404);
  }
});
