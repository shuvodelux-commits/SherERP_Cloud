/**
 * M02-P TEST-ONLY schema-upgrade rehearsal in actual isolated Workerd+D1.
 * The approval_ref column here is added ONLY to ephemeral local test D1.
 * No production migration, remote D1, live identity data or import RPC.
 */
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {compileSyntheticPartyImport} from '../fixtures/m02-party-plan-batch.mjs';
import {
  reconcilePartyIdentityD1,reconcilePartyIdentityApprovalD1
} from '../../src/party/d1-identity-readback.js';

const frozen=name=>JSON.parse(readFileSync(
  new URL('../fixtures/'+name,import.meta.url),'utf8'
));
const source=()=>frozen('party-import.synthetic.json');
const approved=()=>frozen('party-approved.synthetic.json');
const localNow='2026-11-15T00:00:00Z';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-plan-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-party-plan-local-only');
let DB,plan;
const count=table=>DB.prepare('SELECT COUNT(*) AS n FROM '+table).first().then(r=>r.n);
const counts=async()=>({
  parties:await count('parties'),roles:await count('party_roles'),
  links:await count('party_legacy_links'),reviews:await count('party_identity_review')
});
const updateRef=ref=>DB.prepare(
  "UPDATE party_legacy_links SET approval_ref=? WHERE source_group='SUPPLIERS' AND source_id='SUP-001'"
).bind(ref).run();
const withCurrentProof=()=>reconcilePartyIdentityApprovalD1({DB,plan});

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  plan=compileSyntheticPartyImport({
    DB,sourceRows:source(),approvedGroups:approved(),createdAt:localNow
  }).plan;
});
after(async()=>{await harness.close();});

test('base source migration lacks approval_ref and new strict reader fails closed',async()=>{
  const rows=await DB.prepare('PRAGMA table_info(party_legacy_links)').all();
  assert.equal(rows.results.some(row=>row.name==='approval_ref'),false);
  const prior=await counts();
  await assert.rejects(
    withCurrentProof,
    error=>error.message==='Party D1 identity readback unavailable'
  );
  assert.deepEqual(await counts(),prior);
});

test('test-only ALTER adds synthetic approval_ref column without migrating production',async()=>{
  const n=await DB.prepare('SELECT COUNT(*) AS n FROM d1_migrations').first();
  assert.equal(n.n,5,'authentication/provenance/expense migrations must not add Party approval_ref');
  await DB.prepare('ALTER TABLE party_legacy_links ADD COLUMN approval_ref TEXT').run();
  const rows=await DB.prepare('PRAGMA table_info(party_legacy_links)').all();
  assert.equal(rows.results.filter(row=>row.name==='approval_ref').length,1);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM d1_migrations').first()).n,5);
});

test('local readback with empty human approval column reports redacted missing evidence',async()=>{
  const statements=compileSyntheticPartyImport({
    DB,sourceRows:source(),approvedGroups:approved(),createdAt:localNow
  }).statements;
  await DB.batch(statements);
  const prior=await counts();
  assert.deepEqual(prior,{parties:4,roles:7,links:5,reviews:0});
  const report=await withCurrentProof();
  assert.equal(report.identityRowsMatch,false);
  assert.equal(report.approvalEvidencePersistent,false);
  assert.deepEqual(report.issues,[{
    code:'APPROVAL_REF_NOT_PERSISTED',table:'party_legacy_links',field:'approval_ref'
  }]);
  assert.deepEqual(await counts(),prior,'readback must not modify stored Party identities');
  assert.doesNotMatch(JSON.stringify(report),/CUS-001|SUP-001|REVIEW-001|admin-01|01700000000/);
});

test('only exact persisted synthetic approval evidence yields identity readback parity',async()=>{
  const beforeRows=await counts();
  await updateRef(approved()[0].approvalRef);
  const report=await withCurrentProof();
  assert.deepEqual(report.counts.expected,{parties:4,party_roles:7,party_legacy_links:5});
  assert.deepEqual(report.counts.actual,report.counts.expected);
  assert.equal(report.identityRowsMatch,true);
  assert.equal(report.approvalEvidencePersistent,true);
  assert.deepEqual(report.issues,[]);
  assert.deepEqual(await counts(),beforeRows);
  assert.doesNotMatch(JSON.stringify(report),/CUS-001|SUP-001|REVIEW-001|admin-01|01700000000/);
});

test('historical no-column adapter remains fail closed despite test-only schema extension',async()=>{
  const report=await reconcilePartyIdentityD1({DB,plan});
  assert.equal(report.identityRowsMatch,false);
  assert.equal(report.approvalEvidencePersistent,false);
  assert.deepEqual(report.issues,[{
    code:'APPROVAL_REF_NOT_PERSISTED',table:'party_legacy_links',field:'approval_ref'
  }]);
});

test('changed, removed or empty synthetic approval reference fails parity',async()=>{
  const original=approved()[0].approvalRef;
  try{
    for(const altered of ['DIFFERENT-REVIEW',null,'']){
      await updateRef(altered);
      const report=await withCurrentProof();
      assert.equal(report.identityRowsMatch,false);
      assert.equal(report.approvalEvidencePersistent,false);
      assert.ok(report.issues.some(issue=>issue.table==='party_legacy_links'&&
        ['APPROVAL_REF_NOT_PERSISTED','FIELD_MISMATCH'].includes(issue.code)));
    }
  }finally{await updateRef(original);}
});

test('reviewer or timestamp drift invalidates proof even when reference matches',async()=>{
  const originalRef=approved()[0].approvalRef;
  const sql="UPDATE party_legacy_links SET reviewed_by=?, reviewed_at=? WHERE source_group='SUPPLIERS' AND source_id='SUP-001'";
  for(const [reviewer,time] of [
    ['different-reviewer','2026-11-14T12:00:00Z'],
    ['admin-01','2026-11-14T13:00:00Z']
  ]){
    await DB.prepare(sql).bind(reviewer,time).run();
    const report=await withCurrentProof();
    assert.equal(report.identityRowsMatch,false);
    assert.equal(report.approvalEvidencePersistent,false);
    assert.ok(report.issues.some(issue=>issue.code==='FIELD_MISMATCH'));
  }
  await DB.prepare(sql).bind('admin-01','2026-11-14T12:00:00Z').run();
  assert.equal((await withCurrentProof()).identityRowsMatch,true);
  assert.equal((await DB.prepare(
    "SELECT approval_ref FROM party_legacy_links WHERE source_group='SUPPLIERS' AND source_id='SUP-001'"
  ).first()).approval_ref,originalRef);
});

test('strict future-schema reader makes exactly three prepared SELECTs in one D1 batch',async()=>{
  const statements=[];let calls=0;
  const wrapped={
    prepare(sql){statements.push(sql);return DB.prepare(sql);},
    async batch(prepared){calls++;return DB.batch(prepared);}
  };
  const beforeRows=await counts();
  const report=await reconcilePartyIdentityApprovalD1({DB:wrapped,plan});
  assert.equal(report.identityRowsMatch,true);
  assert.equal(calls,1);
  assert.equal(statements.length,3);
  assert.ok(statements.every(sql=>/^\s*SELECT\s/i.test(sql)));
  assert.ok(statements.every(sql=>!/INSERT|UPDATE|DELETE|DROP|PRAGMA|JOIN/i.test(sql)));
  assert.ok(statements[2].includes('approval_ref'));
  assert.deepEqual(await counts(),beforeRows);
});

test('missing, null, numeric and string D1 success envelopes are rejected',async()=>{
  const bad=[undefined,null,false,0,1,'true','false'];
  const beforeRows=await counts();
  for(const value of bad){
    const wrapper={
      prepare(sql){return DB.prepare(sql);},
      async batch(prepared){
        const rows=await DB.batch(prepared);
        return rows.map((r,i)=>i===2?{...r,success:value}:r);
      }
    };
    await assert.rejects(
      ()=>reconcilePartyIdentityApprovalD1({DB:wrapper,plan}),
      error=>error.message==='Party D1 identity readback unavailable'
    );
  }
  assert.deepEqual(await counts(),beforeRows);
});

test('SQL errors, missing D1 binding and malformed batch shapes disclose no identity data',async()=>{
  await assert.rejects(
    ()=>reconcilePartyIdentityApprovalD1({DB:null,plan}),/binding unavailable/
  );
  for(const wrapper of [
    {prepare(){throw new Error('SENSITIVE 01700000000 SUP-001');},batch(){}},
    {prepare(sql){return DB.prepare(sql);},async batch(){return [{success:true,results:[]}];}},
    {prepare(sql){return DB.prepare(sql);},async batch(){throw new Error('Reviewer admin-01 CUS-001');}}
  ]){
    await assert.rejects(
      ()=>reconcilePartyIdentityApprovalD1({DB:wrapper,plan}),
      error=>error.message==='Party D1 identity readback unavailable'
    );
  }
});

test('test-only Worker has no approval route and no financial-account tables',async()=>{
  for(const path of ['/api/rpc','/__m02_test__/approve','/__m02_test__/import']){
    const response=await worker.fetch('http://synthetic.local'+path,{method:'POST',body:'{}'});
    assert.equal(response.status,404);
  }
  const tables=await DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('party_accounts','party_account_entries','party_settlements','cash_book','bank_book','journal_entries')"
  ).all();
  assert.deepEqual(tables.results,[]);
});
