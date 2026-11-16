import test from 'node:test';
import assert from 'node:assert/strict';
import {assessM11Evidence, M11_PHASE_CHECKS} from '../scripts/check-m11-release-evidence.mjs';

const releaseSha = 'a'.repeat(40);
const sourceSha = '29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const options = {expectedReleaseSha:releaseSha, expectedSourceSha:sourceSha};
const everyCheck = [...new Set(Object.values(M11_PHASE_CHECKS).flat())];

function completeManifest() {
  return {
    schemaVersion:1,
    releaseSha,
    sourceSha,
    sourceSnapshotSha256:'b'.repeat(64),
    checks:Object.fromEntries(everyCheck.map(id=>[id,{
      status:'verified', record:'audit/'+id, releaseSha
    }]))
  };
}

test('no manifest fails closed without an M10 approval',()=>{
  const x=assessM11Evidence(undefined,{...options,phase:'prepare'});
  assert.equal(x.documentaryComplete,false);
  assert.ok(x.blockers.some(s=>s.includes('manifest')));
});

test('all three phases require their own relevant evidence',()=>{
  const all=completeManifest();
  for(const phase of ['prepare','switch','handover']){
    assert.deepEqual(assessM11Evidence(all,{...options,phase}).blockers,[]);
    assert.equal(assessM11Evidence(all,{...options,phase}).documentaryComplete,true);
  }
  assert.ok(M11_PHASE_CHECKS.prepare.includes('m10-owner-signoff'));
  assert.ok(M11_PHASE_CHECKS.switch.includes('owner-switch-go'));
  assert.ok(M11_PHASE_CHECKS.handover.includes('postlaunch-smoke-and-handover'));
});

test('M10 sign-off or recovery rehearsal cannot be skipped',()=>{
  const m=completeManifest();
  delete m.checks['m10-owner-signoff'];
  m.checks['restore-and-new-write-replay-drill'].status='pending';
  const x=assessM11Evidence(m,{...options,phase:'prepare'});
  assert.equal(x.documentaryComplete,false);
  assert.ok(x.blockers.some(s=>s.includes('m10-owner-signoff')));
  assert.ok(x.blockers.some(s=>s.includes('restore-and-new-write-replay-drill')));
});

test('later phases block missing frozen-source checksum, final reconciliation, owner GO and live smoke',()=>{
  const m=completeManifest();
  delete m.sourceSnapshotSha256;
  delete m.checks['final-import-gross-reconciliation'];
  delete m.checks['owner-switch-go'];
  delete m.checks['postlaunch-smoke-and-handover'];
  assert.equal(assessM11Evidence(m,{...options,phase:'prepare'}).documentaryComplete,true);
  const sw=assessM11Evidence(m,{...options,phase:'switch'});
  assert.ok(sw.blockers.some(s=>s.includes('sourceSnapshotSha256')));
  assert.ok(sw.blockers.some(s=>s.includes('final-import-gross-reconciliation')));
  assert.ok(sw.blockers.some(s=>s.includes('owner-switch-go')));
  assert.ok(assessM11Evidence(m,{...options,phase:'handover'}).blockers.some(s=>s.includes('postlaunch-smoke-and-handover')));
});

test('reject stale release checks, mismatching release and source commits',()=>{
  const m=completeManifest();
  m.checks['m10-owner-signoff'].releaseSha='c'.repeat(40);
  m.releaseSha='d'.repeat(40);
  m.sourceSha='e'.repeat(40);
  const x=assessM11Evidence(m,{...options,phase:'prepare'});
  assert.ok(x.blockers.some(s=>s.includes('releaseSha')));
  assert.ok(x.blockers.some(s=>s.includes('sourceSha')));
  assert.ok(x.blockers.some(s=>s.includes('m10-owner-signoff')));
});

test('reject ambiguous evidence, injected fields and missing evidence references',()=>{
  const m=completeManifest();
  m.credentials='should-not-be-here';
  m.checks['m10-owner-signoff'].record='';
  m.checks['monitoring-and-incident-rota'].password='do-not-embed';
  const x=assessM11Evidence(m,{...options,phase:'prepare'});
  assert.equal(x.documentaryComplete,false);
  assert.ok(x.blockers.some(s=>s.includes('unknown manifest field')));
  assert.ok(x.blockers.some(s=>s.includes('m10-owner-signoff')));
  assert.ok(x.blockers.some(s=>s.includes('monitoring-and-incident-rota')));
});

test('invalid phase, SHA or missing pinned expected inputs never passes',()=>{
  const m=completeManifest();
  assert.throws(()=>assessM11Evidence(m,{...options,phase:'skip'}),/phase/i);
  assert.equal(assessM11Evidence(m,{expectedReleaseSha:releaseSha,phase:'prepare'}).documentaryComplete,false);
  assert.equal(assessM11Evidence(m,{...options,expectedReleaseSha:'not-a-sha',phase:'prepare'}).documentaryComplete,false);
  assert.equal(assessM11Evidence(m,{...options,phase:'switch',}).documentaryComplete,true);
});

test('references remain non-sensitive identifiers, never free-text evidence or URLs',()=>{
  const m=completeManifest();
  m.checks['m10-owner-signoff'].record='https://example.com/?token=secret';
  assert.ok(assessM11Evidence(m,{...options,phase:'prepare'}).blockers.some(s=>s.includes('m10-owner-signoff')));
});
