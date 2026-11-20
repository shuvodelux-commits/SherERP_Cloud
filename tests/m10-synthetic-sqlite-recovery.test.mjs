import test from 'node:test';
import assert from 'node:assert/strict';
import {runM10SyntheticSqliteRecovery} from '../src/migration/m10-synthetic-sqlite-recovery.js';

const codes=result=>result.issues.map(issue=>issue.code);
const contains=(result,code)=>assert.ok(codes(result).includes(code),`${code}: ${codes(result)}`);
test('49 real local SQLite synthetic groups import, replay, reject changed intent, backup and restore',async()=>{
  const report=await runM10SyntheticSqliteRecovery();
  assert.equal(report.groupsExpected,49);
  assert.equal(report.rowsExpected,98);
  assert.equal(report.candidateSyntheticRehearsal,true);
  assert.deepEqual(report.issues,[]);
  assert.equal(report.authorizesRealImport,false);
  assert.equal(report.authorizesRemoteD1Write,false);
  assert.equal(report.authorizesRestore,false);
  assert.equal(report.productionReady,false);
});
test('rehearsal is deterministic, repeatable and emits no business rows or digests',async()=>{
  const first=await runM10SyntheticSqliteRecovery();
  const second=await runM10SyntheticSqliteRecovery();
  assert.deepEqual(second,first);
  assert.doesNotMatch(JSON.stringify(first),/01700000000|000123\.4500|source_payload|backup\.sqlite|restored\.sqlite|sourceId/);
});
test('missing data in first materialized import is detected even if replay repairs it',async()=>{
  const result=await runM10SyntheticSqliteRecovery({fault:'first-missing'});
  contains(result,'FIRST_MISSING_ROW');
  assert.equal(result.candidateSyntheticRehearsal,false);
});
test('replay content drift fails without silently replacing source',async()=>{
  const result=await runM10SyntheticSqliteRecovery({fault:'replay-tamper'});
  contains(result,'REPLAY_CONTENT_MISMATCH');
  contains(result,'REJECTED_RETRY_CONTENT_MISMATCH');
  assert.equal(result.productionReady,false);
});
test('backup copy is independently scanned for missing rows',async()=>{
  const result=await runM10SyntheticSqliteRecovery({fault:'backup-missing'});
  contains(result,'BACKUP_MISSING_ROW');
  contains(result,'RESTORE_MISSING_ROW');
});
test('independent restored file detects a missing row',async()=>{
  const result=await runM10SyntheticSqliteRecovery({fault:'restore-missing'});
  contains(result,'RESTORE_MISSING_ROW');
});
test('equal-count changed content in restored file fails closed',async()=>{
  const result=await runM10SyntheticSqliteRecovery({fault:'restore-tamper'});
  contains(result,'RESTORE_CONTENT_MISMATCH');
  assert.equal(codes(result).includes('RESTORE_MISSING_ROW'),false);
});
test('preserved original synthetic ID is mandatory even if count and payload agree',async()=>{
  const result=await runM10SyntheticSqliteRecovery({fault:'restore-id-drift'});
  contains(result,'RESTORE_SOURCE_ID_MISMATCH');
});
test('LOGS positional evidence catches reordered ID-less record',async()=>{
  const result=await runM10SyntheticSqliteRecovery({fault:'restore-log-position'});
  contains(result,'RESTORE_MISSING_ROW');
  contains(result,'RESTORE_EXTRA_ROW');
});
test('unexpected extra recovered row is reported',async()=>{
  const result=await runM10SyntheticSqliteRecovery({fault:'restore-extra'});
  contains(result,'RESTORE_EXTRA_ROW');
});
test('unknown mutation fault is rejected with fixed redacted error',async()=>{
  await assert.rejects(runM10SyntheticSqliteRecovery({fault:'https://remote-d1'}),
    {message:'M10 synthetic recovery rehearsal rejected'});
});
