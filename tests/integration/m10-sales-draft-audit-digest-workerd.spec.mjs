import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {importSourceSalesDraftAuditWithD1} from '../../src/db/sales-draft-audit-import.js';
import {summarizeM10SalesDraftAudit} from '../../src/migration/m10-sales-draft-audit-digest.js';

const inventory=JSON.parse(readFileSync(new URL('../../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-sales-draft-audit-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-sales-draft-audit-local-only');
let DB;
const sample=()=>[
  {'Audit ID':'AUD-001',Timestamp:'2026-11-16T10:00Z',Action:'CREATED',
   'Draft ID':'DR-1','Draft No':'D-0001',Version:'01','Actor ID':'U-1',
   'Actor Name':'শুভ','Source Owner ID':'U-1','Invoice ID':'',Note:'',_rowIndex:2},
  {'Audit ID':'AUD-002',Timestamp:'2026-11-16T10:01Z',Action:'POST_CLEANUP_RETRY',
   'Draft ID':'DR-1','Draft No':'D-0001',Version:'02','Actor ID':'U-1',
   'Actor Name':'শুভ','Source Owner ID':'U-1','Invoice ID':'INV-1',Note:'  পুনরায় চেষ্টা  ',_rowIndex:3}
];
const digest=rows=>summarizeM10SalesDraftAudit({inventory,rows});
async function readStored(){
  const result=await DB.prepare('SELECT legacy_sheet_row,audit_id,timestamp_text,action,draft_id,draft_no,version_text,actor_id,actor_name,source_owner_id,invoice_id,note FROM legacy_sales_draft_audit ORDER BY legacy_sheet_row ASC').all();
  assert.equal(result.success,true);
  assert.ok(Array.isArray(result.results));
  return result.results.map(record=>({
    'Audit ID':record.audit_id,Timestamp:record.timestamp_text,Action:record.action,
    'Draft ID':record.draft_id,'Draft No':record.draft_no,Version:record.version_text,
    'Actor ID':record.actor_id,'Actor Name':record.actor_name,
    'Source Owner ID':record.source_owner_id,'Invoice ID':record.invoice_id,
    Note:record.note,_rowIndex:record.legacy_sheet_row
  }));
}
before(async()=>{await harness.listen();await worker.applyD1Migrations('DB');({DB}=await worker.getEnv());});
after(async()=>{await harness.close();});

test('M10 source vs actual local D1 draft-audit readback hashes match independently',async()=>{
  const original=sample(),before=structuredClone(original);
  const count=await DB.prepare('SELECT COUNT(*) AS n FROM legacy_sales_draft_audit').first();
  assert.equal(count.n,0);
  const result=await importSourceSalesDraftAuditWithD1({DB,sourceRows:original});
  assert.deepEqual(result,{sourceGroup:'SALES_DRAFT_AUDIT',importedRows:2,reconciled:true});
  const stored=await readStored();
  assert.notStrictEqual(stored,original);
  assert.deepEqual(stored,original,'source Versions 01/02 survive real SQL storage');
  assert.deepEqual(digest(stored),digest(original));
  assert.deepEqual(original,before);
});

test('approved immutable D1 triggers reject UPDATE/DELETE and retain actual stored audit hash',async()=>{
  const before=digest(await readStored());
  await assert.rejects(()=>DB.prepare("UPDATE legacy_sales_draft_audit SET note='forged'").run(),/immutable|audit/i);
  await assert.rejects(()=>DB.prepare('DELETE FROM legacy_sales_draft_audit').run(),/immutable|audit/i);
  assert.deepEqual(digest(await readStored()),before);
});

test('independently changed readback copy detects Version 02 to 2 without inventing a source-ID change',async()=>{
  const source=await readStored(),before=digest(source);
  const version=structuredClone(source);version[1].Version='2';
  const changed=digest(version);
  assert.notEqual(changed.rowDigest,before.rowDigest);
  assert.equal(changed.idDigest,before.idDigest);
  const note=structuredClone(source);note[1].Note=' altered note ';
  assert.notEqual(digest(note).rowDigest,before.rowDigest);
  assert.equal(digest(note).idDigest,before.idDigest);
});

test('a changed original Audit ID or truncated readback cannot falsely match source evidence',async()=>{
  const stored=await readStored(),base=digest(stored);
  const replaced=structuredClone(stored);replaced[0]['Audit ID']='AUD-FAKE';
  const changed=digest(replaced);
  assert.notEqual(changed.idDigest,base.idDigest);
  assert.notEqual(changed.rowDigest,base.rowDigest);
  const short=digest(stored.slice(0,1));
  assert.equal(short.rowCount,1);
  assert.notEqual(short.idDigest,base.idDigest);
});

test('historical audit importer rejects replay and public test Worker has no API',async()=>{
  await assert.rejects(()=>importSourceSalesDraftAuditWithD1({DB,sourceRows:sample()}),/failed|fresh/i);
  for(const url of ['/api/rpc','/api/health','/__m10__/draft-audit-import']){
    const response=await worker.fetch('http://synthetic.local'+url,{method:'POST',body:'{}'});
    assert.equal(response.status,404);
  }
});
