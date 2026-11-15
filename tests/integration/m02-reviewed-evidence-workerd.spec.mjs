import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {compileSyntheticPartyImport} from '../fixtures/m02-party-plan-batch.mjs';
import {reconcileReviewedPartyIdentityD1} from '../../src/party/d1-reviewed-import-evidence.js';

const fixture=name=>JSON.parse(readFileSync(new URL('../fixtures/'+name,import.meta.url),'utf8'));
const inventory=JSON.parse(readFileSync(new URL('../../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const groupNames=['CUSTOMERS','SUPPLIERS','VENDORS','FINANCE_PERSONS','EXPENSE_PAYEES'];
function filled(){
  const rows=fixture('party-import.synthetic.json');
  const headers=Object.fromEntries(groupNames.map(g=>[
    g,[...inventory.tables.find(t=>t.sheetKey===g).columns]
  ]));
  for(const group of groupNames){
    rows[group]=rows[group].map(row=>({
      ...Object.fromEntries(headers[group].map(field=>[field,''])),
      ...row
    }));
  }
  return {rows,headers};
}
const approvals=fixture('party-approved.synthetic.json');
const inputs=()=>{
  const a=filled(),b=filled();
  return {
    reviewedRows:a.rows,reviewedHeaders:a.headers,
    candidateRows:b.rows,candidateHeaders:b.headers,
    approvedGroups:structuredClone(approvals)
  };
};
const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-plan-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-party-plan-local-only');
let DB;
const now='2026-11-15T00:00:00Z';
before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  const a=inputs();
  await DB.batch(compileSyntheticPartyImport({
    DB,sourceRows:a.candidateRows,approvedGroups:a.approvedGroups,createdAt:now
  }).statements);
});
after(async()=>{await harness.close();});
const rows=async()=>Object.fromEntries(await Promise.all([
  'parties','party_roles','party_legacy_links','party_identity_review'
].map(async table=>[table,(await DB.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n])));
const issue=(report,stage,scope,code)=>report.issues.find(
  i=>i.stage===stage&&i.scope===scope&&i.code===code);

test('real local D1 source-gated readback confirms original IDs/roles yet rejects lost human approval ref',async()=>{
  const beforeCounts=await rows();
  const report=await reconcileReviewedPartyIdentityD1({DB,...inputs()});
  assert.equal(report.formatVersion,1);
  assert.equal(report.sourceValidationClear,true);
  assert.equal(report.readbackChecked,true);
  assert.equal(report.readbackMatches,false);
  assert.equal(report.approvalEvidencePersistent,false);
  assert.equal(report.offlineEvidenceMatches,false);
  assert.deepEqual(report.counts.readback.expected,{
    parties:4,party_roles:7,party_legacy_links:5
  });
  assert.deepEqual(report.counts.readback.actual,report.counts.readback.expected);
  assert.equal(issue(report,'READBACK','party_legacy_links','APPROVAL_REF_NOT_PERSISTED').count,1);
  assert.deepEqual(await rows(),beforeCounts);
  assert.doesNotMatch(JSON.stringify(report),/Rahim|01700000000|SUP-001|CUS-001|admin-01|REVIEW-001/);
});

test('real local D1 binding prepares exactly three fixed SELECT statements in one batch',async()=>{
  const sql=[];let batches=0;
  const binding={
    prepare(statement){sql.push(statement);return DB.prepare(statement);},
    batch(statements){batches++;return DB.batch(statements);}
  };
  const report=await reconcileReviewedPartyIdentityD1({DB:binding,...inputs()});
  assert.equal(report.readbackChecked,true);
  assert.equal(batches,1);
  assert.equal(sql.length,3);
  assert.ok(sql.every(s=>/^SELECT\s/i.test(s.trim())));
  assert.ok(sql.every(s=>!/(INSERT|UPDATE|DELETE|DROP|ALTER|PRAGMA|\bJOIN\b)/i.test(s)));
  assert.ok(sql.some(s=>/FROM parties/i.test(s)));
  assert.ok(sql.some(s=>/FROM party_roles/i.test(s)));
  assert.ok(sql.some(s=>/FROM party_legacy_links/i.test(s)));
  assert.ok(sql.every(s=>!/approval_ref/i.test(s)),'0002 D1 schema has no approval_ref');
});

test('invalid or truncated master headers stop before touching D1 or any reviewer-linked row',async()=>{
  const a=inputs();a.reviewedHeaders.CUSTOMERS.pop();
  let calls=0;
  const rejectingDB={prepare(){calls++;throw new Error('should not access DB');},
    batch(){calls++;throw new Error('should not access DB');}};
  const result=await reconcileReviewedPartyIdentityD1({DB:rejectingDB,...a});
  assert.equal(calls,0);
  assert.equal(result.sourceValidationClear,false);
  assert.equal(result.readbackChecked,false);
  assert.equal(result.readbackMatches,null);
  assert.equal(result.approvalEvidencePersistent,null);
  assert.equal(result.counts.readback,null);
  assert.equal(result.offlineEvidenceMatches,false);
});

test('change to signed Customer opening or Vendor receivable stops all D1 queries',async()=>{
  for(const [group,field,amount] of [
    ['CUSTOMERS','Opening Balance','-100.00'],
    ['VENDORS','Current Receivable','22.50']
  ]){
    const a=inputs();a.candidateRows[group][0][field]=amount;
    const result=await reconcileReviewedPartyIdentityD1({
      DB:{prepare(){throw Error('must not read');},batch(){throw Error('must not batch');}},...a
    });
    assert.equal(result.readbackChecked,false);
    assert.equal(result.offlineEvidenceMatches,false);
    assert.equal(result.sourceUnchanged,undefined);
  }
});

test('numeric phone or unapproved shared phone/name stops before real D1 queries',async()=>{
  const failures=[];
  const unsafe=inputs();unsafe.candidateRows.SUPPLIERS[0].Phone=1700000000;
  failures.push(unsafe);
  const missingProof=inputs();missingProof.approvedGroups=[];
  failures.push(missingProof);
  for(const a of failures){
    const r=await reconcileReviewedPartyIdentityD1({
      DB:{prepare(){throw Error('unexpected');},batch(){throw Error('unexpected');}},...a
    });
    assert.equal(r.readbackChecked,false);
    assert.equal(r.offlineEvidenceMatches,false);
  }
});

test('a broken D1 batch never leaks raw SQL, phone numbers or source IDs',async()=>{
  const failure={prepare(){return {};},async batch(){
    throw new Error('Sensitive 01700000000 CUS-001 REVIEW-001 SQL INSERT');
  }};
  await assert.rejects(
    ()=>reconcileReviewedPartyIdentityD1({DB:failure,...inputs()}),
    e=>e instanceof Error&&e.message==='Party reviewed D1 evidence unavailable'
  );
});

test('missing or false success and incomplete row envelopes fail closed',async()=>{
  for(const invalid of [
    [{results:[]}],
    [{results:[]},{success:true,results:[]},{success:true,results:[]}],
    [{success:false,results:[]},{success:true,results:[]},{success:true,results:[]}],
    [{success:true,results:[]},{success:true,results:[]},{success:true,results:null}]
  ]){
    await assert.rejects(
      ()=>reconcileReviewedPartyIdentityD1({
        DB:{prepare(){return {};},async batch(){return invalid;}},...inputs()
      }),/^Error: Party reviewed D1 evidence unavailable$/);
  }
});

test('missing DB is tolerated only for already-blocked source, never clean source readback',async()=>{
  const blocked=inputs();blocked.candidateHeaders.VENDORS.pop();
  assert.equal((await reconcileReviewedPartyIdentityD1({
    DB:null,...blocked
  })).readbackChecked,false);
  await assert.rejects(
    ()=>reconcileReviewedPartyIdentityD1({DB:null,...inputs()}),
    /^Error: Party reviewed D1 evidence unavailable$/
  );
});

test('source and approval arrays remain unchanged after real D1 readback',async()=>{
  const input=inputs(),before=structuredClone(input);
  await reconcileReviewedPartyIdentityD1({DB,...input});
  assert.deepEqual(input,before);
});

test('non-deployable fixture has no public readback or import RPC endpoints',async()=>{
  for(const path of ['/','/api/rpc','/__m02_test__/import','/__m02_test__/evidence']){
    const result=await worker.fetch('http://synthetic.local'+path,{
      method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
    });
    assert.equal(result.status,404);
  }
});
