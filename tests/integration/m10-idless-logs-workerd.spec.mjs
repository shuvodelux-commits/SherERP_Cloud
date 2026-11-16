import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {importSourceLegacyErrorLogsWithD1} from '../../src/db/legacy-error-log-import.js';
import {summarizeM10IdlessLogs} from '../../src/migration/m10-idless-logs.js';

const inventory=JSON.parse(readFileSync(new URL('../../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-legacy-logs-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-legacy-logs-local-only');
let DB;
const source=()=>[
  {Timestamp:'2026-11-15T09:00:00.000Z',Context:'POS',Message:'  বাংলা 오류  ',_rowIndex:2},
  {Timestamp:'2026-11-15T09:00:00.000Z',Context:'POS',Message:'  বাংলা 오류  ',_rowIndex:3},
  {Timestamp:'',Context:'Report',Message:'missing timestamp',_rowIndex:4}
];
const digest=rows=>summarizeM10IdlessLogs({inventory,rows});
async function readStored(){
  const result=await DB.prepare('SELECT legacy_sheet_row,timestamp_text,context,message FROM legacy_error_logs ORDER BY legacy_sheet_row').all();
  assert.equal(result.success,true);
  assert.ok(Array.isArray(result.results));
  return result.results.map(row=>({
    Timestamp:row.timestamp_text,Context:row.context,Message:row.message,_rowIndex:row.legacy_sheet_row
  }));
}
before(async()=>{await harness.listen();await worker.applyD1Migrations('DB');({DB}=await worker.getEnv());});
after(async()=>{await harness.close();});

test('independent source and persisted D1 LOGS digests preserve duplicate records and positions',async()=>{
  const original=source(),before=structuredClone(original);
  const empty=await DB.prepare('SELECT COUNT(*) AS n FROM legacy_error_logs').first();
  assert.equal(empty.n,0);
  const importResult=await importSourceLegacyErrorLogsWithD1({DB,sourceRows:original});
  assert.deepEqual(importResult,{sourceGroup:'LOGS',importedRows:3,reconciled:true});
  const persisted=await readStored();
  assert.notStrictEqual(persisted,original);
  assert.deepEqual(persisted,original);
  assert.deepEqual(digest(persisted),digest(original));
  assert.equal(digest(persisted).identityKind,'SOURCE_ROW_POSITION_ONLY');
  assert.equal(Object.hasOwn(digest(persisted),'idDigest'),false);
  assert.deepEqual(original,before);
});

test('SQL tamper to a duplicate diagnostic message changes row hash but not source-position provenance',async()=>{
  const base=digest(source());
  const result=await DB.prepare('UPDATE legacy_error_logs SET message=? WHERE legacy_sheet_row=?')
    .bind('PRIVATE_CHANGED_MESSAGE',3).run();
  assert.equal(result.meta.changes,1);
  const current=digest(await readStored());
  assert.notEqual(current.rowDigest,base.rowDigest);
  assert.equal(current.positionDigest,base.positionDigest);
});

test('SQL reassignment to a nonsequential source row position fails closed instead of guessing identity',async()=>{
  const result=await DB.prepare('UPDATE legacy_error_logs SET legacy_sheet_row=? WHERE legacy_sheet_row=?')
    .bind(10,3).run();
  assert.equal(result.meta.changes,1);
  const persisted=await readStored();
  assert.throws(()=>digest(persisted),e=>e.message==='M10 LOGS evidence invalid');
});

test('removing a trailing diagnostic row causes count and both checksums to differ',async()=>{
  await DB.prepare('UPDATE legacy_error_logs SET legacy_sheet_row=? WHERE legacy_sheet_row=?')
    .bind(3,10).run();
  const result=await DB.prepare('DELETE FROM legacy_error_logs WHERE legacy_sheet_row=?').bind(4).run();
  assert.equal(result.meta.changes,1);
  const fromD1=digest(await readStored()),fromSource=digest(source());
  assert.equal(fromD1.rowCount,2);
  assert.notEqual(fromD1.rowDigest,fromSource.rowDigest);
  assert.notEqual(fromD1.positionDigest,fromSource.positionDigest);
});

test('test-only LOGS worker has no public import, RPC or health endpoint',async()=>{
  for(const path of ['/api/rpc','/api/health','/__m10__/logs-import']){
    const result=await worker.fetch('http://synthetic.local'+path,{method:'POST',body:'{}'});
    assert.equal(result.status,404);
  }
});
