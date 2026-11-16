/**
 * TEST-ONLY Workerd/D1 gross-account parity rehearsal, NOT production D1 evidence.
 * Only this suite writes to ephemeral m02_test_checkpoints.
 */
import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {prepareGrossPartyBalances} from '../../src/party/gross-balance-preflight.js';
import {reconcileSyntheticGrossCheckpointsD1} from '../fixtures/m02-gross-checkpoint-d1-reader.mjs';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-plan-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-party-plan-local-only');
let DB;
const review=[{members:[
  {sourceGroup:'CUSTOMERS',sourceId:'CUS-001'},
  {sourceGroup:'SUPPLIERS',sourceId:'SUP-001'},
  {sourceGroup:'VENDORS',sourceId:'VEN-001'},
  {sourceGroup:'FINANCE_PERSONS',sourceId:'FIN-001'},
  {sourceGroup:'EXPENSE_PAYEES',sourceId:'PAY-001'}
],reviewedBy:'synthetic-reviewer',reviewedAt:'2026-11-15T08:00:00Z',
  approvalRef:'SYNTHETIC-ONLY-01'}];
const masters=()=>({
  CUSTOMERS:[{'Customer ID':'CUS-001','Customer Name':'Confidential Synthetic Name','Current Due':'500.00','Opening Balance':'-100.00','_rowIndex':2}],
  SUPPLIERS:[{'Supplier ID':'SUP-001','Supplier Name':'Confidential Synthetic Name','Current Due':'-300.00','Opening Balance':'80.00','_rowIndex':2}],
  VENDORS:[{'Vendor ID':'VEN-001','Vendor Name':'Confidential Synthetic Name','Current Due':'300.00','Current Receivable':'150.00','_rowIndex':2}],
  FINANCE_PERSONS:[{'Person ID':'FIN-001','Person Name':'Confidential Synthetic Name',Roles:'Owner,Lender,Borrower','_rowIndex':2}],
  EXPENSE_PAYEES:[{'Payee ID':'PAY-001','Payee Name':'Confidential Synthetic Name','_rowIndex':2}]
});
const finance=()=>[
  {'Finance ID':'FT-001','Person ID':'FIN-001','Transaction Type':'Opening Owner Capital','Amount':'100.00'},
  {'Finance ID':'FT-002','Person ID':'FIN-001','Transaction Type':'Owner Investment','Amount':'50.00'},
  {'Finance ID':'FT-003','Person ID':'FIN-001','Transaction Type':'Owner Withdrawal','Amount':'200.00'},
  {'Finance ID':'FT-004','Person ID':'FIN-001','Transaction Type':'Loan Received','Amount':'300.00'},
  {'Finance ID':'FT-005','Person ID':'FIN-001','Transaction Type':'Loan Repayment','Amount':'80.00'},
  {'Finance ID':'FT-006','Person ID':'FIN-001','Transaction Type':'Borrower Loan','Amount':'90.00'},
  {'Finance ID':'FT-007','Person ID':'FIN-001','Transaction Type':'Borrower Repayment','Amount':'20.00'}
];
const source=(approvedGroups=review,financeRows=finance())=>prepareGrossPartyBalances({
  sourceRows:masters(),financeRows,approvedGroups
});
const seed=async(preflight=source())=>{
  const rows=[...preflight.currentCheckpoints,...preflight.openingCheckpoints];
  if(rows.length)await DB.batch(rows.map(x=>DB.prepare(
    'INSERT INTO m02_test_checkpoints (party_id,source_group,source_id,account_kind,source_field,basis,amount_minor) VALUES (?,?,?,?,?,?,?)'
  ).bind(x.partyId,x.sourceGroup,x.sourceId,x.kind,x.sourceField,x.basis,x.amountMinor)));
  return preflight;
};
const report=preflight=>reconcileSyntheticGrossCheckpointsD1({DB,preflight});
const reason=(result,stage,code)=>result.issues.find(x=>x.stage===stage&&x.code===code);
const change=async(sql,bindings=[])=>DB.prepare(sql).bind(...bindings).run();

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  await DB.prepare(`CREATE TABLE m02_test_checkpoints(
    party_id TEXT,source_group TEXT,source_id TEXT,
    account_kind TEXT,source_field TEXT,basis TEXT,
    amount_minor INTEGER
  )`).run();
});
after(async()=>{await harness.close();});
beforeEach(async()=>{await DB.prepare('DELETE FROM m02_test_checkpoints').run();});

test('four versioned core/auth/provenance migrations preserve no production Party financial account schema',async()=>{
  const migrationCount=await DB.prepare('SELECT COUNT(*) AS n FROM d1_migrations').first();
  assert.equal(migrationCount.n,4);
  const names=await DB.prepare(`SELECT name FROM sqlite_master
    WHERE type='table' AND name IN ('party_accounts','party_account_entries','journal_entries','party_settlements')`).all();
  assert.deepEqual(names.results,[]);
});
test('all seven gross current and two historical checkpoints round-trip real local D1 without netting',async()=>{
  const preflight=await seed(),prior=structuredClone(preflight),result=await report(preflight);
  assert.deepEqual({source:result.sourcePlanValid,checked:result.readbackChecked,
    current:result.currentMatch,opening:result.openingMatch,offline:result.offlineCheckpointParity},
    {source:true,checked:true,current:true,opening:true,offline:true});
  assert.deepEqual(result.counts,{expectedCurrent:7,observedCurrent:7,expectedOpening:2,observedOpening:2});
  assert.deepEqual(result.issues,[]);
  assert.deepEqual(preflight,prior,'the reader must not mutate private source checkpoints');
  assert.doesNotMatch(JSON.stringify(result),/CUS-001|SUP-001|VEN-001|FIN-001|50000|30000|CUSTOMER_RECEIVABLE|Confidential Synthetic Name|SYNTHETIC-ONLY/);
});
test('one-paisa D1 drift is an AMOUNT_MISMATCH rather than falsely matching gross totals',async()=>{
  const preflight=await seed();
  await change("UPDATE m02_test_checkpoints SET amount_minor=amount_minor+1 WHERE account_kind='CUSTOMER_RECEIVABLE'");
  const r=await report(preflight);
  assert.equal(r.offlineCheckpointParity,false);
  assert.equal(reason(r,'SOURCE_CURRENT','AMOUNT_MISMATCH').count,1);
});
test('one missing Supplier advance never disappears inside a net Party balance',async()=>{
  const preflight=await seed();
  await change("DELETE FROM m02_test_checkpoints WHERE account_kind='SUPPLIER_ADVANCE'");
  const r=await report(preflight);
  assert.equal(reason(r,'SOURCE_CURRENT','MISSING_CHECKPOINT').count,1);
  assert.equal(r.currentMatch,false);
});
test('two-way Vendor obligations remain independent when D1 stores a duplicate account',async()=>{
  const preflight=await seed();
  const row=preflight.currentCheckpoints.find(x=>x.kind==='VENDOR_PAYABLE');
  await change('INSERT INTO m02_test_checkpoints (party_id,source_group,source_id,account_kind,source_field,basis,amount_minor) VALUES (?,?,?,?,?,?,?)',
    [row.partyId,row.sourceGroup,row.sourceId,row.kind,row.sourceField,row.basis,row.amountMinor]);
  const r=await report(preflight);
  assert.equal(reason(r,'SOURCE_CURRENT','DUPLICATE_CHECKPOINT').count,1);
  assert.equal(r.currentMatch,false);
});
test('a D1 record under a different original Source ID fails even with matching Party and money',async()=>{
  const preflight=await seed();
  await change("UPDATE m02_test_checkpoints SET source_id='DIFFERENT-SOURCE' WHERE account_kind='CUSTOMER_RECEIVABLE'");
  const r=await report(preflight);
  assert.equal(reason(r,'SOURCE_CURRENT','MISSING_CHECKPOINT').count,1);
  assert.equal(reason(r,'SOURCE_CURRENT','EXTRA_CHECKPOINT').count,1);
});
test('changed Party ID cannot be inferred from shared name or phone',async()=>{
  const preflight=await seed();
  await change("UPDATE m02_test_checkpoints SET party_id='UNVERIFIED-PARTY' WHERE account_kind='CUSTOMER_RECEIVABLE'");
  assert.equal((await report(preflight)).offlineCheckpointParity,false);
});
test('a historical opening incorrectly stored as current is rejected separately on both bases',async()=>{
  const preflight=await seed();
  await change("UPDATE m02_test_checkpoints SET basis='SOURCE_CURRENT' WHERE basis='HISTORICAL_OPENING' AND account_kind='CUSTOMER_ADVANCE'");
  const r=await report(preflight);
  assert.equal(reason(r,'HISTORICAL_OPENING','MISSING_CHECKPOINT').count,1);
  assert.equal(reason(r,'SOURCE_CURRENT','EXTRA_CHECKPOINT').count,1);
  assert.equal(r.openingMatch,false);
});
test('deleted loan receipt preserves active repayment as separate Lender credit on local D1',async()=>{
  const transactions=finance();transactions[3]['Is Deleted']='TRUE';
  const preflight=await seed(source(review,transactions));
  assert.equal(preflight.summary.deletedFinanceRows,1);
  assert.equal(preflight.currentCheckpoints.some(x=>x.kind==='LENDER_LOAN_PAYABLE'),false);
  const credit=preflight.currentCheckpoints.find(x=>x.kind==='LENDER_CREDIT');
  assert.equal(credit.amountMinor,8000,'active Loan Repayment remains a credit, not cash turnover');
  const r=await report(preflight);
  assert.equal(r.offlineCheckpointParity,true);
  assert.equal(r.counts.expectedCurrent,7,'opposite-sign gross account remains an independent checkpoint');
});
test('invalid/review-pending source plan returns skip without invoking any D1 method',async()=>{
  const bad=source([]);
  const DB={prepare(){throw new Error('SECRET_D1_CALLED')},batch(){throw new Error('SECRET_D1_CALLED')}};
  const r=await reconcileSyntheticGrossCheckpointsD1({DB,preflight:bad});
  assert.equal(r.readbackChecked,false);
  assert.equal(r.sourcePlanValid,false);
  assert.equal(r.offlineCheckpointParity,false);
});
test('missing or failing D1 binding cannot disclose driver errors or source row values',async()=>{
  const preflight=source();
  for(const DB of [null,{prepare(){throw new Error('SECRET-SOURCE-ID')}},{
    prepare(sql){return {sql}},batch(){throw new Error('SECRET-ACCOUNT-MONEY')}
  }]){
    await assert.rejects(()=>reconcileSyntheticGrossCheckpointsD1({DB,preflight}),
      error=>error.message==='Synthetic gross D1 parity unavailable'&&
        !/SECRET/.test(error.message));
  }
});
test('D1 ambiguous batch success envelopes fail closed with fixed exception',async()=>{
  const preflight=source();
  for(const results of [[],[{success:true,results:[]}],[{success:false,results:[]},{success:true,results:[]}]]){
    const DB={prepare(sql){return {sql}},batch:async()=>results};
    await assert.rejects(()=>reconcileSyntheticGrossCheckpointsD1({DB,preflight}),
      error=>error.message==='Synthetic gross D1 parity unavailable');
  }
});
test('local test-only Worker exposes no service endpoints for financial checkpoint reads',async()=>{
  for(const route of ['/','/api/rpc','/__m02_test__/gross-checkpoints']){
    const response=await worker.fetch('http://synthetic.local'+route,{
      method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
    });
    assert.equal(response.status,404);
  }
});
test('helper causes no database mutations or new migration during readback',async()=>{
  const preflight=await seed();
  const before=await DB.prepare('SELECT COUNT(*) AS n FROM m02_test_checkpoints').first();
  await report(preflight);
  const after=await DB.prepare('SELECT COUNT(*) AS n FROM m02_test_checkpoints').first();
  assert.equal(before.n,after.n);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM d1_migrations').first()).n,4);
});
