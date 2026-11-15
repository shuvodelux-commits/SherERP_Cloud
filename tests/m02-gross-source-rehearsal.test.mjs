import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validatePartyGrossRehearsal} from '../src/party/gross-rehearsal-gate.js';

const read=(name)=>JSON.parse(readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8'));
const inventory=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const groups=['CUSTOMERS','SUPPLIERS','VENDORS','FINANCE_PERSONS','EXPENSE_PAYEES'];
const headersFor=(g)=>[...inventory.tables.find(t=>t.sheetKey===g).columns];
const financeHeader=()=>headersFor('FINANCE_TRANSACTIONS');
function fullMaster(){
  const sourceHeaders=Object.fromEntries(groups.map(g=>[g,headersFor(g)]));
  const rows=read('party-import.synthetic.json');
  for(const group of groups)rows[group]=rows[group].map(row=>({
    ...Object.fromEntries(sourceHeaders[group].map(col=>[col,''])),...row
  }));
  rows.CUSTOMERS[0]['Current Due']='120.00';
  rows.CUSTOMERS[0]['Opening Balance']='-5.00';
  rows.SUPPLIERS[0]['Current Due']='-20.00';
  rows.SUPPLIERS[0]['Opening Balance']='10.00';
  return {rows,sourceHeaders};
}
function financeEntry(id,position,type,amount,extra={}){
  return {
    ...Object.fromEntries(financeHeader().map(col=>[col,''])),
    'Finance ID':id,'Transaction Type':type,
    'Person ID':'FIN-001','Person':'Private Finance Name','Amount':amount,
    'Is Deleted':'FALSE',_rowIndex:position,...extra
  };
}
function baseline(){
  const reviewed=fullMaster(),candidate=fullMaster();
  const financeRows=[
    financeEntry('FT-001',2,'Owner Investment','50.00'),
    financeEntry('FT-002',3,'Loan Received','70.00'),
    financeEntry('FT-003',4,'Borrower Loan','15.00')
  ];
  return {
    reviewedRows:reviewed.rows,reviewedHeaders:reviewed.sourceHeaders,
    candidateRows:candidate.rows,candidateHeaders:candidate.sourceHeaders,
    approvedGroups:read('party-approved.synthetic.json'),
    financeRows,financeHeaders:financeHeader(),declaredFinanceRows:3
  };
}
const run=(arg=baseline())=>validatePartyGrossRehearsal(arg);
const issue=(r,stage,code)=>r.issues.find(x=>x.stage===stage && x.code===code);

test('complete frozen Party and Finance exports pass gross design-review preflight with metadata only',()=>{
  const r=run();
  assert.deepEqual({
    version:r.formatVersion,party:r.partySourceValid,finance:r.financeExportValid,
    checked:r.grossPreflightChecked,gross:r.grossDesignReviewClear,
    offline:r.offlineGrossRehearsalClear
  },{version:1,party:true,finance:true,checked:true,gross:true,offline:true});
  assert.deepEqual(r.counts.gross,{
    proposedParties:4,sourceFinanceRows:3,deletedFinanceRows:0,
    pendingIdentityReviews:0,currentCheckpointCount:7,
    historicalOpeningCheckpointCount:2
  });
  assert.deepEqual(r.issues,[]);
  assert.equal(r.counts.finance.declaredRows,3);
  assert.equal(r.counts.party.candidateRows,5);
});
test('gross report cannot disclose the original separate account amounts even when all stages pass',()=>{
  const r=run(),s=JSON.stringify(r);
  assert.doesNotMatch(s,/grossCurrentTotalsMinor|grossOpeningTotalsMinor|amountMinor|SOURCE_CURRENT|HISTORICAL_OPENING|partyId|sourceId|approvedGroups|reviewedBy|REVIEW-001|FT-001|FIN-001|CUS-001|SUP-001|01700000000|12000|7000|5000|Private Finance Name/);
  assert.deepEqual(Object.keys(r.counts).sort(),['finance','gross','party']);
  assert.equal(Object.hasOwn(r,'productionReady'),false);
  assert.equal(Object.hasOwn(r,'cashMovementMinor'),false);
});
test('source drift on signed Customer opening blocks the gross stage despite complete Finance export',()=>{
  const x=baseline();x.candidateRows.CUSTOMERS[0]['Opening Balance']='5.00';
  const r=run(x);
  assert.equal(r.partySourceValid,false);
  assert.equal(r.financeExportValid,true);
  assert.equal(r.grossPreflightChecked,false);
  assert.equal(r.grossDesignReviewClear,null);
  assert.equal(r.counts.gross,null);
  assert.equal(r.offlineGrossRehearsalClear,false);
  assert.ok(issue(r,'IDENTITY_SNAPSHOT','SOURCE_ROW_CHANGED'));
  assert.ok(issue(r,'GATE','GROSS_PREFLIGHT_SKIPPED'));
});
test('two equally truncated master exports never bypass original field coverage',()=>{
  const x=baseline();
  delete x.reviewedRows.VENDORS[0]['Current Receivable'];
  delete x.candidateRows.VENDORS[0]['Current Receivable'];
  const r=run(x);
  assert.equal(r.grossPreflightChecked,false);
  assert.ok(issue(r,'REVIEWED_EXPORT','MISSING_FIELD'));
  assert.ok(issue(r,'CANDIDATE_EXPORT','MISSING_FIELD'));
});
test('wrong frozen Customer header blocks even with full unchanged row values',()=>{
  const x=baseline();x.candidateHeaders.CUSTOMERS.reverse();
  const r=run(x);
  assert.equal(r.grossPreflightChecked,false);
  assert.ok(issue(r,'CANDIDATE_EXPORT','HEADER_MISMATCH'));
});
test('absent human review for the common original Customer/Supplier phone must block gross review',()=>{
  const x=baseline();x.approvedGroups=[];
  const r=run(x);
  assert.equal(r.partySourceValid,false);
  assert.equal(r.counts.gross,null);
  assert.ok(issue(r,'IDENTITY_SNAPSHOT','PENDING_IDENTITY_REVIEW'));
});
test('Finance source count mismatch blocks gross review even with otherwise complete rows',()=>{
  const x=baseline();x.financeRows.pop();
  const r=run(x);
  assert.equal(r.partySourceValid,true);
  assert.equal(r.financeExportValid,false);
  assert.equal(r.grossPreflightChecked,false);
  assert.ok(issue(r,'FINANCE_EXPORT','SOURCE_COUNT_MISMATCH'));
});
test('Finance original Amount header loss blocks all account preflight math',()=>{
  const x=baseline();x.financeHeaders=x.financeHeaders.filter(h=>h!=='Amount');
  const r=run(x);
  assert.equal(r.grossPreflightChecked,false);
  assert.ok(issue(r,'FINANCE_EXPORT','HEADER_MISMATCH'));
});
test('Finance original Amount row omission blocks gross and preserves null stage',()=>{
  const x=baseline();delete x.financeRows[0].Amount;
  const r=run(x);
  assert.equal(r.grossDesignReviewClear,null);
  assert.equal(r.counts.gross,null);
  assert.ok(issue(r,'FINANCE_EXPORT','MISSING_FIELD'));
});
test('nonpositive or over-precision active finance Amount blocks before any gross checkpoint',()=>{
  for(const value of ['0.00','-1','1.999',null]){
    const x=baseline();x.financeRows[0].Amount=value;
    const r=run(x);
    assert.equal(r.financeExportValid,false);
    assert.equal(r.grossPreflightChecked,false);
    assert.ok(issue(r,'FINANCE_EXPORT','INVALID_ACTIVE_AMOUNT'));
  }
});
test('duplicate Finance ID is caught by source exporter before gross preflight',()=>{
  const x=baseline();x.financeRows[1]['Finance ID']='FT-001';
  const r=run(x);
  assert.equal(r.grossPreflightChecked,false);
  assert.ok(issue(r,'FINANCE_EXPORT','DUPLICATE_FINANCE_ID'));
});
test('unmapped but structurally complete Finance Person source ID is blocked only in gross stage',()=>{
  const x=baseline();x.financeRows[0]['Person ID']='FIN-UNKNOWN';
  const r=run(x);
  assert.equal(r.partySourceValid,true);
  assert.equal(r.financeExportValid,true);
  assert.equal(r.grossPreflightChecked,true);
  assert.equal(r.grossDesignReviewClear,false);
  assert.equal(r.offlineGrossRehearsalClear,false);
  assert.equal(issue(r,'GROSS_ACCOUNT','FINANCE_LEGACY_LINK_MISSING').count,1);
});
test('unknown but nonblank Finance source transaction type blocks gross stage',()=>{
  const x=baseline();x.financeRows[0]['Transaction Type']='Unsupported';
  const r=run(x);
  assert.equal(r.grossPreflightChecked,true);
  assert.equal(r.grossDesignReviewClear,false);
  assert.equal(issue(r,'GROSS_ACCOUNT','FINANCE_TYPE_UNKNOWN').count,1);
});
test('Finance source-specific role mismatch stays blocked even when another source shares same Party',()=>{
  const x=baseline();
  for(const copy of [x.reviewedRows,x.candidateRows])copy.FINANCE_PERSONS[0].Roles='Owner';
  const r=run(x);
  assert.equal(r.partySourceValid,true);
  assert.equal(r.financeExportValid,true);
  assert.equal(r.grossPreflightChecked,true);
  assert.equal(r.grossDesignReviewClear,false);
  assert.equal(issue(r,'GROSS_ACCOUNT','FINANCE_ROLE_NOT_MAPPED').count,2);
});
test('negative Vendor due remains independent and fails gross directional review',()=>{
  const x=baseline();
  for(const copy of [x.reviewedRows,x.candidateRows])copy.VENDORS[0]['Current Due']='-300.00';
  const r=run(x);
  assert.equal(r.partySourceValid,true);
  assert.equal(r.financeExportValid,true);
  assert.equal(r.grossPreflightChecked,true);
  assert.equal(r.grossDesignReviewClear,false);
  assert.equal(issue(r,'GROSS_ACCOUNT','VENDOR_NEGATIVE_DIRECTION').count,1);
});
test('a soft-deleted Finance transaction is counted as source history but not posted',()=>{
  const x=baseline();
  x.financeRows[1]['Is Deleted']='TRUE';x.financeRows[1].Amount='';
  const r=run(x);
  assert.equal(r.offlineGrossRehearsalClear,true);
  assert.equal(r.counts.gross.deletedFinanceRows,1);
  assert.equal(r.counts.gross.sourceFinanceRows,3);
  assert.equal(r.counts.gross.currentCheckpointCount,6);
});
test('zero Finance source rows are allowed only with explicit original headers and zero declared source count',()=>{
  const x=baseline();x.financeRows=[];x.declaredFinanceRows=0;
  const r=run(x);
  assert.equal(r.financeExportValid,true);
  assert.equal(r.offlineGrossRehearsalClear,true);
  assert.equal(r.counts.gross.sourceFinanceRows,0);
  assert.equal(r.counts.gross.currentCheckpointCount,4);
});
test('missing independently declared Finance source count fails closed instead of inferring array length',()=>{
  const x=baseline();delete x.declaredFinanceRows;
  assert.throws(()=>run(x),/^Error: Party gross rehearsal unavailable$/);
});
test('malformed original Finance export headers fail closed without source leakage',()=>{
  const x=baseline();x.financeHeaders=null;
  assert.throws(()=>run(x),/^Error: Party gross rehearsal unavailable$/);
});
test('malformed original Party master snapshot fails closed without underlying review ID leaks',()=>{
  const x=baseline();x.candidateRows.CUSTOMERS=null;
  assert.throws(()=>run(x),/^Error: Party gross rehearsal unavailable$/);
});
test('source identifiers, reviewer claims and amounts are never mutated',()=>{
  const x=baseline(),original=structuredClone(x);
  const r=run(x);assert.equal(r.offlineGrossRehearsalClear,true);
  assert.deepEqual(x,original);
});
test('issue diagnostics never echo original source IDs, amounts or user-defined transaction type',()=>{
  const x=baseline();
  x.financeRows[0]['Transaction Type']='SECRET_TX_55555';
  x.financeRows[1]['Person ID']='SECRET_PERSON_44444';
  const r=run(x),s=JSON.stringify(r);
  assert.equal(r.offlineGrossRehearsalClear,false);
  assert.doesNotMatch(s,/SECRET_TX_55555|SECRET_PERSON_44444|FIN-001|REVIEW-001|5000|7000|"Amount"|"Person ID"|"sourceId"|"partyId"/);
  assert.ok(r.issues.every(x=>Object.keys(x).sort().join(',')==='code,count,scope,stage'));
});
test('offline check is never an authenticated D1, production posting or manual settlement action',()=>{
  const r=run();
  for(const field of ['DB','d1Rows','readyForImport','productionReady','partyAccounts',
    'grossCurrentTotalsMinor','reviewerAuthorized','settlements','postedLedgerRows'])
    assert.equal(Object.hasOwn(r,field),false);
});
