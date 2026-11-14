import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const cmd=new URL('../scripts/dry-run-catalog.mjs',import.meta.url).pathname;
const fixture=new URL('./fixtures/catalog-synthetic.json',import.meta.url).pathname;

test('dry-run emits counts only and never synthetic phone data',()=>{
  const result=spawnSync(process.execPath,[cmd,fixture],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const summary=JSON.parse(result.stdout);
  assert.equal(summary.totalRows,4);
  assert.equal(summary.groups.length,3);
  assert.equal(result.stdout.includes('01700000000'),false);
});

test('dry-run refuses an omitted or missing source file',()=>{
  const omitted=spawnSync(process.execPath,[cmd],{encoding:'utf8'});
  assert.notEqual(omitted.status,0);
  const missing=spawnSync(process.execPath,[cmd,'/no-such-erp-export.json'],{encoding:'utf8'});
  assert.notEqual(missing.status,0);
});
