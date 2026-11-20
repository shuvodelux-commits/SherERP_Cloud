import test from 'node:test';
import assert from 'node:assert/strict';
import {runM10SyntheticLinkRestore} from '../src/migration/m10-synthetic-link-restore.js';

const count=(report,code)=>report.issues.find(issue=>issue.code===code)?.count??0;
const contains=(report,code)=>assert.ok(count(report,code)>0,
  `expected ${code}; got ${JSON.stringify(report.issues)}`);

test('local two-Shop graph backs up and restores 18 nodes/16 edges without GO',async()=>{
  const r=await runM10SyntheticLinkRestore();
  assert.equal(r.candidateSyntheticReferenceRestore,true);
  assert.equal(r.groupsExercised,9);
  assert.equal(r.shopsExercised,2);
  assert.equal(r.nodesExpected,18);
  assert.equal(r.edgesExpected,16);
  assert.deepEqual(r.issues,[]);
  assert.equal(r.authorizesRealImport,false);
  assert.equal(r.authorizesRemoteD1Write,false);
  assert.equal(r.authorizesCutover,false);
  assert.equal(r.productionReady,false);
});

test('same original-looking source IDs in different Shops never cross-link',async()=>{
  const first=await runM10SyntheticLinkRestore();
  const second=await runM10SyntheticLinkRestore();
  assert.deepEqual(second,first);
  assert.equal(first.candidateSyntheticReferenceRestore,true);
});

test('restored link with missing Supplier original ID fails even with unchanged counts',async()=>{
  const r=await runM10SyntheticLinkRestore({fault:'restore-orphan-parent'});
  contains(r,'RESTORE_REFERENCE_DRIFT');
  contains(r,'RESTORE_ORPHAN_PARENT');
  contains(r,'RESTORE_FOREIGN_KEY_VIOLATION');
  assert.equal(r.candidateSyntheticReferenceRestore,false);
});

test('restored removed Sale Item leaves orphan edges and a missing node',async()=>{
  const r=await runM10SyntheticLinkRestore({fault:'restore-orphan-child'});
  contains(r,'RESTORE_NODE_MISSING');
  contains(r,'RESTORE_ORPHAN_CHILD');
  contains(r,'RESTORE_FOREIGN_KEY_VIOLATION');
});

test('changed Supplier original ID with same node count breaks independent source links',async()=>{
  const r=await runM10SyntheticLinkRestore({fault:'restore-parent-id-drift'});
  contains(r,'RESTORE_NODE_MISSING');
  contains(r,'RESTORE_NODE_UNEXPECTED');
  contains(r,'RESTORE_ORPHAN_PARENT');
});

test('link redirected to a different EXISTING parent fails even though SQL FKs pass',async()=>{
  const r=await runM10SyntheticLinkRestore({fault:'restore-wrong-parent'});
  contains(r,'RESTORE_REFERENCE_DRIFT');
  assert.equal(count(r,'RESTORE_ORPHAN_PARENT'),0);
  assert.equal(r.candidateSyntheticReferenceRestore,false);
});

test('cross-Shop parent substitution is rejected even when both Shops reuse legacy IDs',async()=>{
  const r=await runM10SyntheticLinkRestore({fault:'restore-cross-shop'});
  contains(r,'RESTORE_CROSS_SHOP_EDGE');
  contains(r,'RESTORE_REFERENCE_DRIFT');
  assert.equal(r.productionReady,false);
});

test('parent retired after source capture blocks reference recovery',async()=>{
  const r=await runM10SyntheticLinkRestore({fault:'restore-retired-parent'});
  contains(r,'RESTORE_NODE_DRIFT');
  contains(r,'RESTORE_RETIRED_PARENT');
});

test('backup tamper is flagged before and after restore',async()=>{
  const r=await runM10SyntheticLinkRestore({fault:'backup-wrong-parent'});
  contains(r,'BACKUP_REFERENCE_DRIFT');
  contains(r,'RESTORE_REFERENCE_DRIFT');
});

test('restored SQLite FK checks disabled must fail closed despite matching rows',async()=>{
  const r=await runM10SyntheticLinkRestore({fault:'restore-fk-off'});
  contains(r,'RESTORE_FK_ENFORCEMENT_OFF');
  contains(r,'RESTORE_FK_PROBE_NOT_ENFORCED');
  assert.equal(count(r,'RESTORE_NODE_MISSING'),0);
});

test('restored SQLite missing actual FK DDL must fail even with matching 18 nodes',async()=>{
  const r=await runM10SyntheticLinkRestore({fault:'restore-fk-removed'});
  contains(r,'RESTORE_FK_SCHEMA_MISMATCH');
  contains(r,'RESTORE_FK_PROBE_NOT_ENFORCED');
  assert.equal(count(r,'RESTORE_REFERENCE_DRIFT'),0);
});

test('redacted deterministic reports do not expose source IDs, SQL, paths or private values',async()=>{
  const r=await runM10SyntheticLinkRestore({fault:'restore-cross-shop'});
  const output=JSON.stringify(r);
  assert.doesNotMatch(output,/SUP-000001|PUR-000001|SHOP-ALPHA|SHOP-BETA|CREATE TABLE|SELECT |\.sqlite|legacy_id|source_id|\/tmp\//i);
  assert.equal(r.authorizesRealImport,false);
  assert.equal(r.productionReady,false);
});

test('unsupported fault fails with fixed redacted error, without any path or input echo',async()=>{
  await assert.rejects(runM10SyntheticLinkRestore({fault:'D1 REMOTE SECRET'}),
    {message:'M10 synthetic link recovery rejected'});
});
