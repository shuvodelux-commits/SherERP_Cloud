import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareGrossPartyBalances} from '../src/party/gross-balance-preflight.js';

const master=(id,roles,name='Source Person')=>({
  'Person ID':id,'Person Name':name,'Phone':'','Roles':roles,
  'Person Type':roles.split(',')[0],'Status':'Active','_rowIndex':2
});
const tx=(id,personId,type,amount)=>({
  'Finance ID':id,'Person ID':personId,'Person':'Source Person',
  'Transaction Type':type,'Amount':amount,'Is Deleted':''
});
const source=(people)=>({
  CUSTOMERS:[],SUPPLIERS:[],VENDORS:[],FINANCE_PERSONS:people,
  EXPENSE_PAYEES:[]
});
const review=(members)=>[{
  members:members.map(sourceId=>({sourceGroup:'FINANCE_PERSONS',sourceId})),
  reviewedBy:'synthetic-reviewer',reviewedAt:'2026-11-15T10:00:00Z',
  approvalRef:'SYNTHETIC-ID-REVIEW'
}];
const audit=(masters,financeRows,approvedGroups=[])=>prepareGrossPartyBalances({
  sourceRows:source(masters),financeRows,approvedGroups
});
const financePositions=report=>report.currentCheckpoints
  .filter(p=>p.sourceGroup==='FINANCE_PERSONS');
const reasons=report=>report.blockingIssues.map(issue=>issue.reason);

test('padded transaction ID must not silently resolve to an unpadded only-master ID',()=>{
  const masters=[master('FIN-001','Owner,Lender')];
  const rows=[tx('F-1',' FIN-001 ','Loan Received','100.00')];
  const report=audit(masters,rows);
  assert.equal(report.readyForAccountDesignReview,false);
  assert.ok(reasons(report).includes('FINANCE_LEGACY_LINK_MISSING'));
  assert.deepEqual(financePositions(report),[]);
  assert.equal(report.grossCurrentTotalsMinor.LENDER_LOAN_PAYABLE,undefined);
});

test('distinct literal source Person IDs with equal trimmed text keep independent accounts',()=>{
  const masters=[
    master('FIN-001','Owner','Owner Record'),
    {...master(' FIN-001 ','Lender','Lender Record'),_rowIndex:3}
  ];
  const rows=[
    tx('F-1','FIN-001','Owner Investment','70.00'),
    tx('F-2',' FIN-001 ','Loan Received','180.00')
  ];
  const before=structuredClone({masters,rows});
  const report=audit(masters,rows);
  assert.equal(report.readyForAccountDesignReview,true);
  assert.equal(report.summary.proposedParties,2);
  assert.deepEqual(financePositions(report).map(row=>({
    sourceId:row.sourceId,kind:row.kind,amountMinor:row.amountMinor
  })),[
    {sourceId:' FIN-001 ',kind:'LENDER_LOAN_PAYABLE',amountMinor:18000},
    {sourceId:'FIN-001',kind:'OWNER_EQUITY',amountMinor:7000}
  ]);
  assert.equal(new Set(financePositions(report).map(row=>row.partyId)).size,2);
  assert.deepEqual({masters,rows},before);
});

test('human-reviewed Party grouping never lets another original Person ID lend its finance role',()=>{
  const masters=[
    master('FIN-001','Owner','Owner Record'),
    {...master(' FIN-001 ','Lender','Lender Record'),_rowIndex:3}
  ];
  const rows=[
    tx('F-1','FIN-001','Loan Received','30.00'),
    tx('F-2',' FIN-001 ','Loan Received','20.00')
  ];
  const report=audit(masters,rows,review(['FIN-001',' FIN-001 ']));
  assert.equal(report.summary.proposedParties,1);
  assert.equal(report.readyForAccountDesignReview,false);
  assert.ok(reasons(report).includes('FINANCE_ROLE_NOT_MAPPED'));
  assert.deepEqual(financePositions(report).map(row=>({
    sourceId:row.sourceId,kind:row.kind,amountMinor:row.amountMinor
  })),[
    {sourceId:' FIN-001 ',kind:'LENDER_LOAN_PAYABLE',amountMinor:2000}
  ]);
});

test('matching exact padded source ID is retained, not normalized or discarded',()=>{
  const id=' FIN-001 ';
  const report=audit([master(id,'Borrower')],[
    tx('F-1',id,'Borrower Loan','55.00')
  ]);
  assert.equal(report.readyForAccountDesignReview,true);
  assert.deepEqual(financePositions(report).map(row=>({
    sourceId:row.sourceId,kind:row.kind,amountMinor:row.amountMinor
  })),[{sourceId:id,kind:'BORROWER_LOAN_RECEIVABLE',amountMinor:5500}]);
  assert.deepEqual(report.blockingIssues,[]);
});

test('truly blank Person ID remains an explicit required-ID blocker, without name-linking',()=>{
  const report=audit([master('FIN-001','Owner')],[
    tx('F-1','  ','Owner Investment','99.00')
  ]);
  assert.equal(report.readyForAccountDesignReview,false);
  assert.ok(reasons(report).includes('FINANCE_PERSON_ID_REQUIRED'));
  assert.deepEqual(financePositions(report),[]);
});
