import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {compileSyntheticPartyImport} from '../fixtures/m02-party-plan-batch.mjs';
import {planPartyImport} from '../../src/party/party-import-plan.js';
import {reconcilePartyIdentityD1} from '../../src/party/d1-identity-readback.js';
import {summarizeOpenPartyIdentityReviews} from '../../src/party/d1-review-queue-summary.js';

const masters=JSON.parse(readFileSync(new URL('../fixtures/party-import.synthetic.json',import.meta.url),'utf8'));
const approvals=JSON.parse(readFileSync(new URL('../fixtures/party-approved.synthetic.json',import.meta.url),'utf8'));
const source=()=>structuredClone(masters);
const reviewed=()=>structuredClone(approvals);
const now='2026-11-15T00:00:00Z';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-plan-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-party-plan-local-only');
let DB;
before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
});
after(async()=>{await harness.close();});

const compile=(sourceRows=source(),approvedGroups=reviewed())=>
  compileSyntheticPartyImport({DB,sourceRows,approvedGroups,createdAt:now});
const count=async(table)=> (await DB.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n;
const counts=async()=>Object.fromEntries(await Promise.all([
  'parties','party_roles','party_legacy_links','party_identity_review'
].map(async name=>[name,await count(name)])));

test('unreviewed same-name/phone and missing-ID quarantine prevent any SQL plan',async()=>{
  const before=await counts();
  assert.throws(()=>compile(source(),[]),/review|unresolved|quarantin/i);
  const missing=source();missing.VENDORS[0]['Vendor ID']='';
  assert.throws(()=>compile(missing,[]),/review|unresolved|quarantin/i);
  const duplicate=source();duplicate.CUSTOMERS.push({...duplicate.CUSTOMERS[0],_rowIndex:3});
  assert.throws(()=>compile(duplicate,[]),/review|unresolved|quarantin/i);
  assert.deepEqual(await counts(),before,'pure compile must do no writes');
});

test('reviewed link evidence cannot be forged from missing/unknown source IDs',async()=>{
  const changes=reviewed();changes[0].reviewedBy='';
  assert.throws(()=>compile(source(),changes),/review|evidence|invalid/i);
  const unknown=reviewed();unknown[0].members.push({sourceGroup:'FINANCE_PERSONS',sourceId:'FIN-DOES-NOT-EXIST'});
  assert.throws(()=>compile(source(),unknown),/unknown|quarantin/i);
});

test('one atomic local D1 import preserves 5 source links, 7 roles and 4 independent Parties',async()=>{
  const input=source();const prior=structuredClone(input);
  const out=compile(input);
  assert.equal(out.plan.summary.proposedParties,4);
  assert.equal(out.plan.summary.legacyLinks,5);
  assert.equal(out.plan.summary.roleMemberships,7);
  assert.equal(out.plan.summary.pendingIdentityReviews,0);
  assert.equal(out.statements.length,16);
  assert.deepEqual(input,prior,'source input must remain unchanged');
  await DB.batch(out.statements);
  assert.deepEqual(await counts(),{
    parties:4,party_roles:7,party_legacy_links:5,party_identity_review:0
  });
  const approved=await DB.prepare(`SELECT source_group,source_id,party_id,link_basis,
    reviewed_by,reviewed_at,legacy_sheet_row,status
    FROM party_legacy_links WHERE source_group IN ('CUSTOMERS','SUPPLIERS')
    ORDER BY source_group`).all();
  assert.deepEqual(approved.results.map(x=>x.source_id),['CUS-001','SUP-001']);
  assert.equal(approved.results[0].party_id,approved.results[1].party_id);
  assert.equal(approved.results[0].link_basis,'ORIGINAL_RECORD');
  assert.equal(approved.results[1].link_basis,'HUMAN_VERIFIED');
  assert.equal(approved.results[1].reviewed_by,'admin-01');
  assert.equal(approved.results[1].reviewed_at,'2026-11-14T12:00:00Z');
  assert.equal(approved.results[0].legacy_sheet_row,2);
  assert.equal(approved.results[1].legacy_sheet_row,2);
  const finance=await DB.prepare(`SELECT role FROM party_roles WHERE party_id=(
    SELECT party_id FROM party_legacy_links WHERE source_group='FINANCE_PERSONS' AND source_id='FIN-001'
  ) ORDER BY role`).all();
  assert.deepEqual(finance.results.map(x=>x.role),['Borrower','Lender','Owner']);
  const payee=await DB.prepare(`SELECT status FROM party_roles WHERE party_id=(
    SELECT party_id FROM party_legacy_links WHERE source_group='EXPENSE_PAYEES' AND source_id='PAY-001'
  ) AND role='Payee'`).first();
  assert.equal(payee.status,'INACTIVE');
});

test('repeating same frozen import rejects replay without duplicating any identity, role or link',async()=>{
  const before=await counts();
  await assert.rejects(()=>DB.batch(compile().statements),/unique|constraint|primary key/i);
  assert.deepEqual(await counts(),before);
  const row=await DB.prepare(`SELECT COUNT(*) AS n FROM party_legacy_links
    WHERE source_group='CUSTOMERS' AND source_id='CUS-001'`).first();
  assert.equal(row.n,1);
});

test('failed second D1 write atomically rolls back a new Party and preserves imported snapshot',async()=>{
  const before=await counts();
  const ops=[
    DB.prepare(`INSERT INTO parties (party_id,display_name,created_at)
      VALUES ('PT-ROLLBACK-TEST','Synthetic New Party',?)`).bind(now),
    DB.prepare(`INSERT INTO party_legacy_links
      (party_id,source_group,source_id,link_basis,created_at)
      VALUES ('PT-ROLLBACK-TEST','CUSTOMERS','CUS-001','ORIGINAL_RECORD',?)`).bind(now)
  ];
  await assert.rejects(()=>DB.batch(ops),/unique|constraint/i);
  assert.deepEqual(await counts(),before);
  assert.equal(await DB.prepare("SELECT COUNT(*) AS n FROM parties WHERE party_id='PT-ROLLBACK-TEST'").first().then(x=>x.n),0);
});

test('local rehearsal does not create accounts/cash/bank or expose RPC and test-only routes',async()=>{
  const tables=await DB.prepare(`SELECT name FROM sqlite_master WHERE type='table'
    AND name IN ('party_accounts','party_account_entries','journal_entries',
                 'party_settlements','cash_book','bank_book')`).all();
  assert.deepEqual(tables.results,[]);
  for(const pathname of ['/', '/api/rpc','/__m02_test__/import']){
    const response=await worker.fetch('http://synthetic.local'+pathname,{
      method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
    });
    assert.equal(response.status,404);
  }
});
test('real local D1 identity readback reconciles all source IDs while blocking unpersisted approvalRef',async()=>{
  const expected=compile().plan,prior=await counts();
  const audit=await reconcilePartyIdentityD1({DB,plan:expected});
  assert.deepEqual(audit.counts.expected,{parties:4,party_roles:7,party_legacy_links:5});
  assert.deepEqual(audit.counts.actual,audit.counts.expected);
  assert.equal(audit.identityRowsMatch,false);
  assert.equal(audit.approvalEvidencePersistent,false);
  assert.deepEqual(audit.issues,[{code:'APPROVAL_REF_NOT_PERSISTED',table:'party_legacy_links',field:'approval_ref'}]);
  assert.deepEqual(await counts(),prior);
  assert.doesNotMatch(JSON.stringify(audit),/CUS-001|SUP-001|01700000000|admin-01|REVIEW-001/);
});

test('one D1 prepared SELECT-only batch reads all three identity tables consistently',async()=>{
  const queries=[];let calls=0;
  const binding={
    prepare(sql){queries.push(sql);return DB.prepare(sql);},
    batch(statements){calls++;return DB.batch(statements);}
  };
  const result=await reconcilePartyIdentityD1({DB:binding,plan:compile().plan});
  assert.equal(calls,1,'no read/await/replan sequence across multiple D1 transactions');
  assert.equal(queries.length,3);
  assert.ok(queries.every(sql=>/^SELECT\s/i.test(sql.trim())));
  assert.ok(queries.every(sql=>!/INSERT|UPDATE|DELETE|DROP|PRAGMA|JOIN/i.test(sql)));
  assert.equal(result.identityRowsMatch,false);
});

test('readback against real D1 detects modified role status without changing persisted source links',async()=>{
  const before=await counts();
  await DB.prepare("UPDATE party_roles SET status='INACTIVE' WHERE role='Customer'").run();
  try{
    const report=await reconcilePartyIdentityD1({DB,plan:compile().plan});
    assert.equal(report.identityRowsMatch,false);
    assert.ok(report.issues.some(x=>x.code==='FIELD_MISMATCH'&&x.table==='party_roles'&&x.field==='status'));
    assert.doesNotMatch(JSON.stringify(report),/CUS-001|SUP-001|admin-01/);
  }finally{
    await DB.prepare("UPDATE party_roles SET status='ACTIVE' WHERE role='Customer'").run();
  }
  assert.deepEqual(await counts(),before);
});

test('D1 readback flags unexpected Party even when the SQL row is structurally valid',async()=>{
  const prior=await counts();
  await DB.prepare("INSERT INTO parties(party_id,display_name,created_at) VALUES('PT-READBACK-EXTRA','Synthetic Unexpected','2026-11-15T00:00:00Z')").run();
  try{
    const report=await reconcilePartyIdentityD1({DB,plan:compile().plan});
    assert.ok(report.issues.some(x=>x.code==='EXTRA_ROW'&&x.table==='parties'));
    assert.equal(report.identityRowsMatch,false);
  }finally{
    await DB.prepare("DELETE FROM parties WHERE party_id='PT-READBACK-EXTRA'").run();
  }
  assert.deepEqual(await counts(),prior);
});

test('missing or failed D1 binding cannot leak SQL errors or real Party details',async()=>{
  await assert.rejects(()=>reconcilePartyIdentityD1({DB:null,plan:compile().plan}),/binding/i);
  const broken={
    prepare(){return {};},
    async batch(){throw new Error('SENSITIVE_NAME 01700000000');}
  };
  await assert.rejects(
    ()=>reconcilePartyIdentityD1({DB:broken,plan:compile().plan}),
    error=>error instanceof Error&&/readback unavailable/i.test(error.message)&&
      !/SENSITIVE_NAME|01700000000/.test(error.message)
  );
});

test('reused human approval reference cannot create D1 writes for disjoint identities',async()=>{
  const before=await counts();
  const groups=reviewed();
  groups.push({
    members:[
      {sourceGroup:'VENDORS',sourceId:'VEN-001'},
      {sourceGroup:'EXPENSE_PAYEES',sourceId:'PAY-001'}
    ],
    reviewedBy:'admin-01',reviewedAt:'2026-11-14T12:00:00Z',
    approvalRef:groups[0].approvalRef
  });
  assert.throws(()=>compile(source(),groups),/approval.*(reus|duplic)|(?:reus|duplic).*approval/i);
  assert.deepEqual(await counts(),before);
});

test('real workerd/D1 identity review queue is initially empty and read-only',async()=>{
  const before=await counts();
  assert.deepEqual(await summarizeOpenPartyIdentityReviews({DB}),{
    totalOpen:0,byReason:[]
  });
  assert.deepEqual(await counts(),before);
});

test('real D1 OPEN review counts exclude confirmed/rejected and never change Party identities',async()=>{
  const before=await counts();
  const reviewedAt='2026-11-14T12:00:00Z';
  const items=[
    ['REV-SUM-1','CUSTOMERS',null,'MISSING_ID','OPEN'],
    ['REV-SUM-2','SUPPLIERS','SUP-001','SHARED_PHONE','OPEN'],
    ['REV-SUM-3','VENDORS','VEN-001','SHARED_PHONE','OPEN'],
    ['REV-SUM-4','FINANCE_PERSONS','FIN-001','SAME_NAME','OPEN'],
    ['REV-SUM-5','EXPENSE_PAYEES','PAY-001','OTHER','CONFIRMED'],
    ['REV-SUM-6','CUSTOMERS','CUS-001','OTHER','REJECTED']
  ];
  await DB.batch(items.map(([id,group,sourceId,reason,status])=>
    DB.prepare(`INSERT INTO party_identity_review
      (review_id,source_group,source_id,reason,status,reviewer_id,reviewed_at,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).bind(
      id,group,sourceId,reason,status,
      status==='OPEN'?null:'synthetic-reviewer',
      status==='OPEN'?null:reviewedAt,now
    )
  ));
  const report=await summarizeOpenPartyIdentityReviews({DB});
  assert.deepEqual(report,{totalOpen:4,byReason:[
    {reason:'MISSING_ID',count:1},
    {reason:'SAME_NAME',count:1},
    {reason:'SHARED_PHONE',count:2}
  ]});
  assert.doesNotMatch(JSON.stringify(report),/CUS-001|SUP-001|VEN-001|reviewer|01700000000|Rahim/);
  const after=await counts();
  assert.equal(after.parties,before.parties);
  assert.equal(after.party_roles,before.party_roles);
  assert.equal(after.party_legacy_links,before.party_legacy_links);
  assert.equal(after.party_identity_review,before.party_identity_review+6);
  for(const path of ['/api/rpc','/__m02_test__/reviews']){
    const response=await worker.fetch('http://synthetic.local'+path,{
      method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
    });
    assert.equal(response.status,404,'review queue is never a public route');
  }
});


test('Party import real-D1 readback rejects ambiguous batch success flags without writes or data disclosure',async()=>{
  const plan=compile().plan;
  const original=await counts();
  const rejected=[{label:'missing',value:undefined},{label:'null',value:null},
    {label:'numeric zero',value:0},{label:'numeric one',value:1},
    {label:'string true',value:'true'},{label:'explicit false',value:false}];
  for(const variant of rejected){
    const intercepted={
      prepare(sql){return DB.prepare(sql);},
      async batch(statements){
        const readback=await DB.batch(statements);
        assert.equal(readback.length,3);
        return readback.map((entry,index)=>{
          if(index!==1)return entry;
          if(variant.label==='missing'){
            const {success,...withoutSuccess}=entry;
            return withoutSuccess;
          }
          return {...entry,success:variant.value};
        });
      }
    };
    await assert.rejects(
      ()=>reconcilePartyIdentityD1({DB:intercepted,plan}),
      error=>error instanceof Error &&
        error.message==='Party D1 identity readback unavailable',
      variant.label+' batch status must fail closed'
    );
  }
  const valid=await reconcilePartyIdentityD1({DB,plan});
  assert.deepEqual(valid.issues,[{
    code:'APPROVAL_REF_NOT_PERSISTED',
    table:'party_legacy_links',
    field:'approval_ref'
  }],'genuine successful readback must still block missing human approval evidence');
  assert.deepEqual(await counts(),original,'readback must never mutate Party tables');
});


test('Party review queue rejects ambiguous D1 success flags and impossible zero group counts',async()=>{
  const before=await counts();
  const first=await summarizeOpenPartyIdentityReviews({DB});
  assert.equal(first.totalOpen,4,'real D1 must have four previously seeded open reviews');
  const malformed=[
    {label:'missing',mutate:result=>{const {success,...rest}=result;return rest;}},
    {label:'undefined',mutate:result=>({...result,success:undefined})},
    {label:'null',mutate:result=>({...result,success:null})},
    {label:'numeric zero',mutate:result=>({...result,success:0})},
    {label:'numeric one',mutate:result=>({...result,success:1})},
    {label:'string',mutate:result=>({...result,success:'true'})},
    {label:'false',mutate:result=>({...result,success:false})}
  ];
  for(const {label,mutate} of malformed){
    const intercepted={prepare(sql){
      assert.match(sql.trim(),/^SELECT\s/i,'review summaries are read-only SQL');
      const statement=DB.prepare(sql);
      return {async all(){return mutate(await statement.all());}};
    }};
    await assert.rejects(
      ()=>summarizeOpenPartyIdentityReviews({DB:intercepted}),
      error=>error instanceof Error &&
        error.message==='Party identity review summary unavailable',
      label+' result status must fail closed'
    );
  }

  const impossible={prepare(sql){
    const statement=DB.prepare(sql);
    return {async all(){
      const original=await statement.all();
      assert.equal(original.success,true);
      assert.ok(original.results.length>0);
      return {...original,results:[
        {...original.results[0],count:0},...original.results.slice(1)
      ]};
    }};
  }};
  await assert.rejects(
    ()=>summarizeOpenPartyIdentityReviews({DB:impossible}),
    error=>error instanceof Error &&
      error.message==='Invalid Party identity review summary',
    'COUNT(*) GROUP BY cannot generate a zero-count group'
  );
  assert.deepEqual(await counts(),before,'review diagnostic must never write');
  const valid=await summarizeOpenPartyIdentityReviews({DB});
  assert.equal(valid.totalOpen,4);
  assert.doesNotMatch(JSON.stringify(valid),
    /CUS-001|SUP-001|VEN-001|01700000000|admin-01|Rahim/,
    'all summaries must remain source-ID and PII free');
});


test('unsafe legacy physical row never compiles D1 Party identity inserts or mutates existing Parties',async()=>{
  const before=await counts();
  const input=source(),prior=structuredClone(input);
  input.SUPPLIERS[0]._rowIndex=Number.MAX_SAFE_INTEGER+1;
  let prepared=0;
  const intercepted={
    prepare(sql){prepared++;return DB.prepare(sql);}
  };
  assert.throws(()=>compileSyntheticPartyImport({
    DB:intercepted,sourceRows:input,approvedGroups:reviewed(),createdAt:now
  }),/invalid legacy row position/i);
  assert.equal(prepared,0,'all source row provenance must validate before preparing any D1 statement');
  assert.deepEqual(await counts(),before,'unsafe source row cannot change local D1');
  assert.deepEqual(source(),prior,'the original frozen source fixture remains unchanged');
});


test('real D1 Party identity readback never certifies two original anchors in tampered offline plan',async()=>{
  const before=await counts();
  const plan=structuredClone(compile().plan);
  const verified=plan.links.find(x=>x.linkBasis==='HUMAN_VERIFIED');
  assert.ok(verified);
  verified.linkBasis='ORIGINAL_RECORD';
  verified.reviewedBy=null;
  verified.reviewedAt=null;
  verified.approvalRef=null;
  const report=await reconcilePartyIdentityD1({DB,plan});
  assert.equal(report.identityRowsMatch,false);
  assert.equal(report.approvalEvidencePersistent,false);
  assert.ok(report.issues.some(x=>x.code==='PLAN_LINKAGE_INVALID'&&x.table==='plan'));
  assert.doesNotMatch(JSON.stringify(report),/CUS-001|SUP-001|REVIEW-001|admin-01|01700000000/);
  assert.deepEqual(await counts(),before,'real D1 readback remains SELECT only');
});


test('real D1 identity readback flags forged reviewed-group summary without mutating Party rows',async()=>{
  const before=await counts();
  const plan=structuredClone(compile().plan);
  assert.equal(plan.summary.reviewedGroups,1);
  plan.summary.reviewedGroups=0;
  const report=await reconcilePartyIdentityD1({DB,plan});
  assert.equal(report.identityRowsMatch,false);
  assert.equal(report.approvalEvidencePersistent,false);
  assert.ok(report.issues.some(x=>x.code==='PLAN_LINKAGE_INVALID'&&x.table==='plan'));
  assert.ok(report.issues.some(x=>x.code==='APPROVAL_REF_NOT_PERSISTED'),
    'the current schema still cannot prove authenticated review persistence');
  assert.doesNotMatch(JSON.stringify(report),
    /CUS-001|SUP-001|REVIEW-001|admin-01|01700000000/);
  assert.deepEqual(await counts(),before,'real local D1 readback remains SELECT-only');
});


test('real D1 readback refuses invalid UTC reviewer timestamp in tampered in-memory proposal',async()=>{
  const before=await counts();
  const plan=structuredClone(compile().plan);
  const verified=plan.links.find(link=>link.linkBasis==='HUMAN_VERIFIED');
  assert.ok(verified,'frozen fixture has reviewed source link');
  verified.reviewedAt='2026-02-30T12:00:00Z';
  const report=await reconcilePartyIdentityD1({DB,plan});
  assert.equal(report.identityRowsMatch,false);
  assert.equal(report.approvalEvidencePersistent,false);
  assert.ok(report.issues.some(issue=>issue.code==='PLAN_LINKAGE_INVALID'&&issue.table==='plan'));
  assert.ok(report.issues.some(issue=>issue.code==='APPROVAL_REF_NOT_PERSISTED'),
    'old production D1 schema remains unable to prove approval-reference persistence');
  assert.doesNotMatch(JSON.stringify(report),
    /CUS-001|SUP-001|REVIEW-001|admin-01|01700000000|2026-02-30/);
  assert.deepEqual(await counts(),before,'read-only reconciliation must never write D1');
});


test('duplicate source physical anchor is stable across local D1 preflight ordering and prevents SQL',async()=>{
  const before=await counts();
  const rows=source();
  rows.CUSTOMERS.push({
    ...rows.CUSTOMERS[0],
    'Customer Name':'Different source business',
    _rowIndex:3
  });
  const swapped=structuredClone(rows);
  swapped.CUSTOMERS.reverse();
  const original=structuredClone(rows);
  const plans=[rows,swapped].map(input=>planPartyImport(input,[]));
  const reviews=plans.map(plan=>plan.reviewItems.filter(item=>
    item.reason==='DUPLICATE_ID'&&item.sourceGroup==='CUSTOMERS'));
  assert.equal(reviews[0].length,1);
  assert.deepEqual(reviews[0],reviews[1],
    'same exact duplicate source identity must not change review provenance if array order flips');
  assert.equal(reviews[0][0].legacySheetRow,2);
  for(const input of [rows,swapped]){
    let prepared=0;
    const binding={prepare(sql){prepared++;return DB.prepare(sql);}};
    assert.throws(()=>compileSyntheticPartyImport({
      DB:binding,sourceRows:input,approvedGroups:reviewed(),createdAt:now
    }),/review|quarantin|unknown/i);
    assert.equal(prepared,0,'quarantined duplicate rows cannot prepare any SQL statements');
  }
  assert.deepEqual(await counts(),before,'local D1 rows must remain untouched');
  assert.deepEqual(rows,original,'offline source snapshot unchanged');
});
