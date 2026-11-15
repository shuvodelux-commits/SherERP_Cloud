import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareGrossPartyBalances} from '../src/party/gross-balance-preflight.js';

function source(){
  return {CUSTOMERS:[],SUPPLIERS:[],VENDORS:[],
    FINANCE_PERSONS:[{
      'Person ID':'SYN-PER-1','Person Name':'Synthetic Finance Party',
      'Person Type':'Owner',Roles:'Owner,Lender,Borrower',
      Phone:'01900000000',Status:'Active',_rowIndex:2
    }],EXPENSE_PAYEES:[]};
}
function tx(id,amount,deletedFlag='FALSE',type='Owner Investment'){
  return {'Finance ID':id,'Person ID':'SYN-PER-1',
    'Transaction Type':type,Amount:amount,'Is Deleted':deletedFlag};
}
function audit(rows){
  const masters=source(),before=structuredClone({masters,rows});
  const report=prepareGrossPartyBalances({
    sourceRows:masters,approvedGroups:[],financeRows:rows
  });
  assert.deepEqual({masters,rows},before,'preflight cannot mutate source data');
  assert.deepEqual(report.summary.effects,{
    cashMovementMinor:0,bankMovementMinor:0,postedLedgerRows:0
  });
  assert.doesNotMatch(JSON.stringify(report),/Synthetic Finance Party|01900000000/);
  return report;
}
const financePositions=report=>report.currentCheckpoints.filter(x=>
  x.sourceGroup==='FINANCE_PERSONS');

test('Finance gross preflight excludes whitespace-padded TRUE deletion markers',()=>{
  for(const flag of [' TRUE ','\ttrue\n']){
    const report=audit([
      tx('SYN-LIVE','12.50'),
      tx('SYN-DELETED','900.00',flag,'Loan Received')
    ]);
    assert.equal(report.readyForAccountDesignReview,true);
    assert.deepEqual(report.blockingIssues,[]);
    assert.equal(report.summary.sourceFinanceRows,2);
    assert.equal(report.summary.deletedFinanceRows,1,
      'source export and gross preflight must agree on soft-delete markers');
    assert.deepEqual(report.grossCurrentTotalsMinor,{OWNER_EQUITY:1250});
    assert.deepEqual(financePositions(report).map(x=>x.kind),['OWNER_EQUITY']);
  }
});

test('padded TRUE soft-deleted Finance transaction may repeat a live original Finance ID',()=>{
  const report=audit([
    tx('SYN-REPLAY','8.00'),
    tx('SYN-REPLAY','8000.00','  true  ','Owner Withdrawal')
  ]);
  assert.equal(report.readyForAccountDesignReview,true);
  assert.deepEqual(report.blockingIssues,[]);
  assert.equal(report.summary.deletedFinanceRows,1);
  assert.deepEqual(report.grossCurrentTotalsMinor,{OWNER_EQUITY:800});
  assert.equal(financePositions(report).length,1);
});

test('padded TRUE soft-deleted Finance row with absent Amount is not treated as live money',()=>{
  const report=audit([
    tx('SYN-LIVE','3.40'),
    tx('SYN-GONE',null,' TRUE ','Loan Received')
  ]);
  assert.equal(report.readyForAccountDesignReview,true);
  assert.deepEqual(report.blockingIssues,[]);
  assert.deepEqual(report.grossCurrentTotalsMinor,{OWNER_EQUITY:340});
  assert.equal(report.summary.deletedFinanceRows,1);
});

test('FALSE and padded false remain active Finance transactions',()=>{
  const report=audit([
    tx('SYN-F1','2.00','FALSE'),
    tx('SYN-F2','3.25',' false ')
  ]);
  assert.equal(report.readyForAccountDesignReview,true);
  assert.equal(report.summary.deletedFinanceRows,0);
  assert.deepEqual(report.grossCurrentTotalsMinor,{OWNER_EQUITY:525});
});

test('literal boolean true and bare uppercase TRUE remain soft-deleted',()=>{
  const report=audit([
    tx('SYN-LIVE','1.25'),
    tx('SYN-B1','100.00',true),
    tx('SYN-B2','100.00','TRUE')
  ]);
  assert.equal(report.readyForAccountDesignReview,true);
  assert.equal(report.summary.deletedFinanceRows,2);
  assert.deepEqual(report.grossCurrentTotalsMinor,{OWNER_EQUITY:125});
});
