import test from 'node:test';
import assert from 'node:assert/strict';
import {runM10SyntheticSqliteRecovery} from '../src/migration/m10-synthetic-sqlite-recovery.js';

const issue=(report,code)=>report.issues.find(x=>x.code===code)?.count??0;

test('baseline synthetic recovery retains schema and constraints without granting release',async()=>{
  const report=await runM10SyntheticSqliteRecovery();
  assert.equal(report.candidateSyntheticRehearsal,true);
  assert.deepEqual(report.issues,[]);
  assert.equal(report.authorizesRealImport,false);
  assert.equal(report.authorizesRemoteD1Write,false);
  assert.equal(report.productionReady,false);
});

test('backup that loses UNIQUE constraint is detected despite 98 identical rows',async()=>{
  const report=await runM10SyntheticSqliteRecovery({fault:'backup-schema-drift'});
  assert.equal(issue(report,'BACKUP_SCHEMA_MISMATCH'),1);
  assert.equal(issue(report,'BACKUP_UNIQUE_CONSTRAINT_LOST'),1);
  assert.equal(issue(report,'RESTORE_SCHEMA_MISMATCH'),1);
  assert.equal(issue(report,'BACKUP_CONTENT_MISMATCH'),0);
  assert.equal(issue(report,'BACKUP_MISSING_ROW'),0);
  assert.equal(report.candidateSyntheticRehearsal,false);
});

test('restored file with same 98 rows but missing UNIQUE constraint is rejected',async()=>{
  const report=await runM10SyntheticSqliteRecovery({fault:'restore-schema-drift'});
  assert.equal(issue(report,'RESTORE_SCHEMA_MISMATCH'),1);
  assert.equal(issue(report,'RESTORE_UNIQUE_CONSTRAINT_LOST'),1);
  assert.equal(issue(report,'RESTORE_CONTENT_MISMATCH'),0);
  assert.equal(issue(report,'RESTORE_MISSING_ROW'),0);
  assert.equal(issue(report,'BACKUP_SCHEMA_MISMATCH'),0);
});

test('unapproved additional restored schema object fails closed',async()=>{
  const report=await runM10SyntheticSqliteRecovery({fault:'restore-extra-table'});
  assert.equal(issue(report,'RESTORE_SCHEMA_MISMATCH'),1);
  assert.equal(report.candidateSyntheticRehearsal,false);
});

test('changed SQLite schema-version marker with intact rows is rejected',async()=>{
  const report=await runM10SyntheticSqliteRecovery({fault:'restore-schema-version'});
  assert.equal(issue(report,'RESTORE_SCHEMA_MISMATCH'),1);
  assert.equal(issue(report,'RESTORE_CONTENT_MISMATCH'),0);
});

test('damaged backup file is rejected with fixed redacted error',async()=>{
  await assert.rejects(
    runM10SyntheticSqliteRecovery({fault:'backup-corrupt-header'}),
    {message:'M10 synthetic recovery rehearsal rejected'}
  );
});

test('damaged restored file is rejected with fixed redacted error',async()=>{
  await assert.rejects(
    runM10SyntheticSqliteRecovery({fault:'restore-corrupt-header'}),
    {message:'M10 synthetic recovery rehearsal rejected'}
  );
});

test('schema-fault summaries do not leak payloads, paths or SQL definitions',async()=>{
  const report=await runM10SyntheticSqliteRecovery({fault:'restore-schema-drift'});
  const output=JSON.stringify(report);
  assert.doesNotMatch(output,/01700000000|000123\.4500|source_payload|SELECT |CREATE TABLE|backup\.sqlite|restored\.sqlite|sourceId/i);
  assert.equal(report.productionReady,false);
});
