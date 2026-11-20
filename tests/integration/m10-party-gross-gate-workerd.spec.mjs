/**
 * M10 Run 7 — synthetic source, actual isolated Workerd/D1 migrated Party tables.
 * No production Party balances, real identities, RPC, remote D1 or public writes.
 */
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {planPartyImport} from '../../src/party/party-import-plan.js';
import {prepareGrossPartyBalances} from '../../src/party/gross-balance-preflight.js';
import {compileSyntheticPartyImport} from '../fixtures/m02-party-plan-batch.mjs';
import {assessM10PartyGrossLocalD1} from '../../src/migration/m10-party-gross-local-d1-gate.js';

const now='2026-11-20T06:39:00Z';
const approved=()=>[{members:[
  {sourceGroup:'CUSTOMERS',sourceId:'CUS-007'},
  {sourceGroup:'SUPPLIERS',sourceId:'SUP-007'}
],reviewedBy:'synthetic-auditor',reviewedAt:'2026-11-20T06:00:00Z',
  approvalRef:'SYNTH-M10-APPROVAL'}];
const masters=()=>({
  CUSTOMERS:[{'Customer ID':'CUS-007','Customer Name':'Fake Shop A','Phone':'01700000000',
    'Current Due':'500.00','Opening Balance':'-100.00',Status:'Active',_rowIndex:2}],
  SUPPLIERS:[{'Supplier ID':'SUP-007','Supplier Name':'Fake Shop A','Phone':'01700000000',
    'Current Due':'-300.00','Opening Balance':'80.00',Status:'Active',_rowIndex:2}],
  VENDORS:[{'Vendor ID':'VEN-007','Vendor Name':'Fake Vendor',
    'Current Due':'300.00','Current Receivable':'150.00',_rowIndex:2}],
  FINANCE_PERSONS:[{'Person ID':'FIN-007','Person Name':'Fake Finance',
    Roles:'Owner,Lender,Borrower',Status:'Active',_rowIndex:2}],
  EXPENSE_PAYEES:[{'Payee ID':'PAY-007','Payee Name':'Fake Payee',
    Status:'Inactive',_rowIndex:2}]
});
const finance=()=>[
  {'Finance ID':'FT-01','Person ID':'FIN-007','Transaction Type':'Opening Owner Capital','Amount':'100.00'},
  {'Finance ID':'FT-02','Person ID':'FIN-007','Transaction Type':'Owner Investment','Amount':'50.00'},
  {'Finance ID':'FT-03','Person ID':'FIN-007','Transaction Type':'Owner Withdrawal','Amount':'200.00'},
  {'Finance ID':'FT-04','Person ID':'FIN-007','Transaction Type':'Loan Received','Amount':'300.00'},
  {'Finance ID':'FT-05','Person ID':'FIN-007','Transaction Type':'Loan Repayment','Amount':'80.00'},
  {'Finance ID':'FT-06','Person ID':'FIN-007','Transaction Type':'Borrower Loan','Amount':'90.00'},
  {'Finance ID':'FT-07','Person ID':'FIN-007','Transaction Type':'Borrower Repayment','Amount':'20.00'}
];
const plan=()=>planPartyImport(masters(),approved());
const gross=()=>prepareGrossPartyBalances({
  sourceRows:masters(),approvedGroups:approved(),financeRows:finance()
});
const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-plan-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-party-plan-local-only');
let DB;
const report=(mode='BASE_SCHEMA',preflight=gross(),identityPlan=plan(),connection=DB)=>
  assessM10PartyGrossLocalD1({DB:connection,preflight,identityPlan,mode});
const issue=(r,code)=>r.issues.find(x=>x.code===code)?.count??0;
const count=table=>DB.prepare('SELECT COUNT(*) AS n FROM '+table).first().then(x=>x.n);
const change=(sql,...params)=>DB.prepare(sql).bind(...params).run();

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  // TEST-ONLY! This table is absent in actual D1 migrations.
  await DB.prepare(`CREATE TABLE m02_test_checkpoints(
    party_id TEXT,source_group TEXT,source_id TEXT,
    account_kind TEXT,source_field TEXT,basis TEXT,amount_minor INTEGER)`).run();
});
after(async()=>{await harness.close();});

test('actual 14 migrated D1 versions do not create a financial posting or approval schema',async()=>{
  assert.equal(await count('d1_migrations'),14);
  for(const name of ['party_accounts','party_account_entries','journal_entries']){
    const q=await DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(name).first();
    assert.equal(q,null);
  }
  const columns=(await DB.prepare('PRAGMA table_info(party_legacy_links)').all()).results;
  assert.equal(columns.some(x=>x.name==='approval_ref'),false);
});

test('blocked gross plan and mismatched source identity stop before a D1 connection',async()=>{
  const spy={prepare(){throw Error('MUST_NOT_READ_D1')},batch(){throw Error('MUST_NOT_READ_D1')}};
  const sourceBlocked=prepareGrossPartyBalances({
    sourceRows:masters(),approvedGroups:[],financeRows:finance()
  });
  let r=await report('BASE_SCHEMA',sourceBlocked,plan(),spy);
  assert.equal(r.readbackPerformed,false);
  assert.equal(r.candidateSyntheticCombinedParity,false);
  assert.ok(issue(r,'SOURCE_PLAN_BLOCKED')>0);
  const tampered=structuredClone(gross());
  tampered.currentCheckpoints[0].partyId='PT-NONMATCHING';
  r=await report('BASE_SCHEMA',tampered,plan(),spy);
  assert.equal(r.readbackPerformed,false);
  assert.ok(issue(r,'SOURCE_LINK_MISMATCH')>0 || issue(r,'SOURCE_PLAN_BLOCKED')>0);
});

test('independently compile existing source Party SQL and gross checkpoints into local-only D1',async()=>{
  const src=masters(),original=structuredClone(src);
  const compiled=compileSyntheticPartyImport({
    DB,sourceRows:src,approvedGroups:approved(),createdAt:now
  });
  assert.equal(compiled.plan.summary.reviewedGroups,1);
  await DB.batch(compiled.statements);
  const checkpoints=[...gross().currentCheckpoints,...gross().openingCheckpoints];
  await DB.batch(checkpoints.map(c=>DB.prepare(`INSERT INTO m02_test_checkpoints
    (party_id,source_group,source_id,account_kind,source_field,basis,amount_minor)
    VALUES(?,?,?,?,?,?,?)`).bind(
    c.partyId,c.sourceGroup,c.sourceId,c.kind,c.sourceField,c.basis,c.amountMinor
  )));
  assert.deepEqual(src,original);
  assert.equal(await count('parties'),4);
  assert.equal(await count('party_roles'),7);
  assert.equal(await count('party_legacy_links'),5);
  assert.equal(await count('m02_test_checkpoints'),9);
});

test('gross current and historical numbers may match while unpersisted approval keeps whole gate NO-GO',async()=>{
  const r=await report();
  assert.equal(r.readbackPerformed,true);
  assert.equal(r.grossCurrentMatch,true);
  assert.equal(r.grossOpeningMatch,true);
  assert.equal(r.grossCheckpointParity,true);
  assert.equal(r.identityRowsMatch,false);
  assert.equal(r.approvalEvidencePersistent,false);
  assert.equal(issue(r,'IDENTITY_APPROVAL_REF_NOT_PERSISTED'),1);
  assert.equal(r.candidateSyntheticCombinedParity,false);
  assert.equal(r.authorizesRealImport,false);
  assert.equal(r.authorizesRemoteD1Write,false);
  assert.equal(r.productionReady,false);
});

test('BASE_SCHEMA audit reads only fixed five SELECTs in one actual D1 batch',async()=>{
  const queries=[];let batches=0;
  const db={prepare(sql){queries.push(sql);return DB.prepare(sql);},
    async batch(rows){batches++;return DB.batch(rows);}};
  const r=await report('BASE_SCHEMA',gross(),plan(),db);
  assert.equal(r.grossCheckpointParity,true);
  assert.equal(batches,1);
  assert.equal(queries.length,5);
  assert.ok(queries.every(x=>/^SELECT\s/i.test(x.trim())));
  assert.ok(queries.every(x=>!/\b(?:INSERT|UPDATE|DELETE|DROP|CREATE|PRAGMA|ATTACH|DETACH)\b/i.test(x)));
});

test('test-only approval_ref extension can create internal synthetic joint parity, never production GO',async()=>{
  await DB.prepare('ALTER TABLE party_legacy_links ADD COLUMN approval_ref TEXT').run();
  await change(`UPDATE party_legacy_links SET approval_ref=?
    WHERE source_group='SUPPLIERS' AND source_id='SUP-007'`,approved()[0].approvalRef);
  assert.equal(await count('d1_migrations'),14,'test-only column is not an operational migration');
  const r=await report('LOCAL_TEST_APPROVAL_COLUMN');
  assert.deepEqual(r.issues,[]);
  assert.equal(r.identityRowsMatch,true);
  assert.equal(r.approvalEvidencePersistent,true);
  assert.equal(r.grossCheckpointParity,true);
  assert.equal(r.crossSourceRoleLinksMatch,true);
  assert.equal(r.candidateSyntheticCombinedParity,true);
  assert.equal(r.authorizesCutover,false);
  assert.equal(r.productionReady,false);
  assert.doesNotMatch(JSON.stringify(r),/CUS-007|SUP-007|FIN-007|50000|synthetic-auditor|SYNTH-M10-APPROVAL|SELECT|INSERT/i);
});

test('BASE_SCHEMA still refuses to infer approval evidence even after local optional column exists',async()=>{
  const r=await report();
  assert.equal(r.grossCheckpointParity,true);
  assert.equal(r.identityRowsMatch,false);
  assert.equal(issue(r,'IDENTITY_APPROVAL_REF_NOT_PERSISTED'),1);
  assert.equal(r.candidateSyntheticCombinedParity,false);
});

test('one paisa current receivable drift blocks both gross and joint gate',async()=>{
  await change("UPDATE m02_test_checkpoints SET amount_minor=amount_minor+1 WHERE account_kind='CUSTOMER_RECEIVABLE'");
  try{
    const r=await report('LOCAL_TEST_APPROVAL_COLUMN');
    assert.equal(r.identityRowsMatch,true);
    assert.equal(r.grossCurrentMatch,false);
    assert.equal(issue(r,'GROSS_SOURCE_CURRENT_AMOUNT_MISMATCH'),1);
    assert.equal(r.candidateSyntheticCombinedParity,false);
  }finally{
    await change("UPDATE m02_test_checkpoints SET amount_minor=amount_minor-1 WHERE account_kind='CUSTOMER_RECEIVABLE'");
  }
});

test('Vendor payable/receivable swapped at unchanged NET TOTAL still fails both gross obligations',async()=>{
  await change(`UPDATE m02_test_checkpoints SET amount_minor=CASE account_kind
    WHEN 'VENDOR_PAYABLE' THEN 15000 WHEN 'VENDOR_RECEIVABLE' THEN 30000
    ELSE amount_minor END WHERE account_kind IN ('VENDOR_PAYABLE','VENDOR_RECEIVABLE')`);
  try{
    const r=await report('LOCAL_TEST_APPROVAL_COLUMN');
    assert.equal(issue(r,'GROSS_SOURCE_CURRENT_AMOUNT_MISMATCH'),2);
    assert.equal(r.candidateSyntheticCombinedParity,false);
  }finally{
    await change(`UPDATE m02_test_checkpoints SET amount_minor=CASE account_kind
      WHEN 'VENDOR_PAYABLE' THEN 30000 WHEN 'VENDOR_RECEIVABLE' THEN 15000
      ELSE amount_minor END WHERE account_kind IN ('VENDOR_PAYABLE','VENDOR_RECEIVABLE')`);
  }
});

test('Owner, Lender and Borrower account kinds cannot be netted or swapped',async()=>{
  await change(`UPDATE m02_test_checkpoints SET amount_minor=CASE account_kind
    WHEN 'LENDER_LOAN_PAYABLE' THEN 7000
    WHEN 'BORROWER_LOAN_RECEIVABLE' THEN 22000
    ELSE amount_minor END WHERE account_kind IN ('LENDER_LOAN_PAYABLE','BORROWER_LOAN_RECEIVABLE')`);
  try{
    const r=await report('LOCAL_TEST_APPROVAL_COLUMN');
    assert.equal(issue(r,'GROSS_SOURCE_CURRENT_AMOUNT_MISMATCH'),2);
    assert.equal(r.grossCurrentMatch,false);
  }finally{
    await change(`UPDATE m02_test_checkpoints SET amount_minor=CASE account_kind
      WHEN 'LENDER_LOAN_PAYABLE' THEN 22000
      WHEN 'BORROWER_LOAN_RECEIVABLE' THEN 7000
      ELSE amount_minor END WHERE account_kind IN ('LENDER_LOAN_PAYABLE','BORROWER_LOAN_RECEIVABLE')`);
  }
});

test('historical opening cannot be reclassified as current financial activity',async()=>{
  await change(`UPDATE m02_test_checkpoints SET basis='SOURCE_CURRENT'
    WHERE basis='HISTORICAL_OPENING' AND account_kind='CUSTOMER_ADVANCE'`);
  try{
    const r=await report('LOCAL_TEST_APPROVAL_COLUMN');
    assert.equal(r.grossCurrentMatch,false);
    assert.equal(r.grossOpeningMatch,false);
    assert.ok(issue(r,'GROSS_SOURCE_CURRENT_EXTRA_CHECKPOINT')>0);
    assert.ok(issue(r,'GROSS_HISTORICAL_OPENING_MISSING_CHECKPOINT')>0);
  }finally{
    await change(`UPDATE m02_test_checkpoints SET basis='HISTORICAL_OPENING'
      WHERE basis='SOURCE_CURRENT' AND account_kind='CUSTOMER_ADVANCE'`);
  }
});

test('a wrong original source ID fails despite the same Party and amount',async()=>{
  await change("UPDATE m02_test_checkpoints SET source_id='CUS-IMPOSTOR' WHERE account_kind='CUSTOMER_RECEIVABLE'");
  try{
    const r=await report('LOCAL_TEST_APPROVAL_COLUMN');
    assert.equal(r.grossCurrentMatch,false);
    assert.equal(issue(r,'GROSS_SOURCE_CURRENT_MISSING_CHECKPOINT'),1);
    assert.equal(issue(r,'GROSS_SOURCE_CURRENT_EXTRA_CHECKPOINT'),1);
  }finally{
    await change("UPDATE m02_test_checkpoints SET source_id='CUS-007' WHERE account_kind='CUSTOMER_RECEIVABLE'");
  }
});

test('Party reviewer evidence changes invalidate link even when exact gross cash balances match',async()=>{
  await change(`UPDATE party_legacy_links SET approval_ref='UNREVIEWED'
    WHERE source_group='SUPPLIERS' AND source_id='SUP-007'`);
  try{
    const r=await report('LOCAL_TEST_APPROVAL_COLUMN');
    assert.equal(r.grossCheckpointParity,true);
    assert.equal(r.identityRowsMatch,false);
    assert.ok(issue(r,'IDENTITY_FIELD_MISMATCH')>0);
    assert.equal(r.candidateSyntheticCombinedParity,false);
  }finally{
    await change(`UPDATE party_legacy_links SET approval_ref=?
      WHERE source_group='SUPPLIERS' AND source_id='SUP-007'`,approved()[0].approvalRef);
  }
});

test('a missing linked Party role refuses joint parity without altering gross checkpoints',async()=>{
  await change("UPDATE party_roles SET status='INACTIVE' WHERE role='Supplier'");
  try{
    const r=await report('LOCAL_TEST_APPROVAL_COLUMN');
    assert.equal(r.grossCheckpointParity,true);
    assert.equal(r.identityRowsMatch,false);
    assert.ok(issue(r,'IDENTITY_FIELD_MISMATCH')>0);
  }finally{
    await change("UPDATE party_roles SET status='ACTIVE' WHERE role='Supplier'");
  }
});

test('missing checkpoint and duplicate checkpoint are detected separately',async()=>{
  const row=await DB.prepare(`SELECT * FROM m02_test_checkpoints
    WHERE account_kind='SUPPLIER_ADVANCE' AND basis='SOURCE_CURRENT'`).first();
  await change("DELETE FROM m02_test_checkpoints WHERE account_kind='SUPPLIER_ADVANCE' AND basis='SOURCE_CURRENT'");
  try{
    let r=await report('LOCAL_TEST_APPROVAL_COLUMN');
    assert.equal(issue(r,'GROSS_SOURCE_CURRENT_MISSING_CHECKPOINT'),1);
  }finally{
    await DB.prepare(`INSERT INTO m02_test_checkpoints
      (party_id,source_group,source_id,account_kind,source_field,basis,amount_minor)
      VALUES (?,?,?,?,?,?,?)`).bind(row.party_id,row.source_group,row.source_id,
      row.account_kind,row.source_field,row.basis,row.amount_minor).run();
  }
  await DB.prepare(`INSERT INTO m02_test_checkpoints
    (party_id,source_group,source_id,account_kind,source_field,basis,amount_minor)
    VALUES (?,?,?,?,?,?,?)`).bind(row.party_id,row.source_group,row.source_id,
    row.account_kind,row.source_field,row.basis,row.amount_minor).run();
  try{
    const r=await report('LOCAL_TEST_APPROVAL_COLUMN');
    assert.equal(issue(r,'GROSS_SOURCE_CURRENT_DUPLICATE_CHECKPOINT'),1);
  }finally{
    await change(`DELETE FROM m02_test_checkpoints WHERE rowid=(
      SELECT max(rowid) FROM m02_test_checkpoints)`);
  }
});

test('an invalid D1 envelope fails closed without disclosing driver values',async()=>{
  const fake={prepare(sql){return DB.prepare(sql);},async batch(ops){
    const reply=await DB.batch(ops);
    return reply.map((row,i)=>i===4?{...row,success:1}:row);
  }};
  await assert.rejects(()=>report('LOCAL_TEST_APPROVAL_COLUMN',gross(),plan(),fake),
    e=>e.message==='M10 local Party gross gate unavailable');
  await assert.rejects(()=>report('LOCAL_TEST_APPROVAL_COLUMN',gross(),plan(),
    {prepare(){throw Error('SECRET-CUS-007 01700000000')}}),
    e=>e.message==='M10 local Party gross gate unavailable');
});

test('unknown proof mode never opens the database',async()=>{
  const spy={prepare(){throw Error('SHOULD_NOT_READ')},batch(){throw Error('SHOULD_NOT_READ')}};
  await assert.rejects(()=>report('REAL_PRODUCTION',gross(),plan(),spy),
    e=>e.message==='M10 local Party gross gate unavailable');
});

test('synthetic package cannot expose private D1, Party or financial RPC endpoint',async()=>{
  for(const path of ['/','/api/rpc','/__m10__/finance','/api/import']){
    const result=await worker.fetch('http://synthetic.local'+path,{
      method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
    });
    assert.equal(result.status,404);
  }
  assert.equal((await report('LOCAL_TEST_APPROVAL_COLUMN')).candidateSyntheticCombinedParity,true);
  assert.equal(await count('d1_migrations'),14);
});
