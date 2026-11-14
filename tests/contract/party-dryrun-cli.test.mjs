import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const script=new URL('../../scripts/dry-run-party.mjs',import.meta.url).pathname;
const snapshot=new URL('../fixtures/party-import.synthetic.json',import.meta.url).pathname;
const approved=new URL('../fixtures/party-approved.synthetic.json',import.meta.url).pathname;
const run=(args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8'});

test('Party dry-run returns counts only and never exposes names or phone numbers',()=>{
  const r=run([snapshot]);
  assert.equal(r.status,0,r.stderr);
  const summary=JSON.parse(r.stdout);
  assert.equal(summary.sourceRows,5);
  assert.equal(summary.proposedParties,5);
  assert.equal(summary.pendingIdentityReviews,2);
  assert.ok(!r.stdout.includes('Rahim'));
  assert.ok(!r.stdout.includes('01700000000'));
  assert.ok(!r.stdout.includes('CUS-001'));
});

test('Party dry-run accepts separately human-reviewed grouping without writing to D1',()=>{
  const r=run([snapshot,approved]);
  assert.equal(r.status,0,r.stderr);
  const summary=JSON.parse(r.stdout);
  assert.equal(summary.proposedParties,4);
  assert.equal(summary.reviewedGroups,1);
  assert.equal(summary.pendingIdentityReviews,0);
});

test('Party dry-run refuses absent and missing source file, never assumes live Sheets',()=>{
  assert.notEqual(run([]).status,0);
  assert.notEqual(run(['/missing-private-erp-party-file.json']).status,0);
});
