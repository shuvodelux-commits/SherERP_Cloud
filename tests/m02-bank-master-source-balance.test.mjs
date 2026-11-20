/**
 * M02 Run 12 — historical BANK_ACCOUNTS/BANK_BOOK, synthetic offline tests.
 * No real original data, no D1 and no cash/financial posting.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditBankMasterSourceBalance} from '../src/party/m02-bank-master-source-balance.js';

const A=(id='BA-000001',opening='100.00',current='94.00',row=2)=>({
  'Bank Account ID':id,'Account Name':'Personal private account',
  'Account Number':'SECRET_ACCOUNT_000', 'Opening Balance':opening,
  'Current Balance':current,'Account Type':'Bank',
  Status:'Active',_rowIndex:row
});
const B=(id,bank,type,reference,debit,credit,balance,row,status='Active',reversalOf='')=>({
  'Entry ID':id,'Bank Account ID':bank,Type:type,Reference:reference,
  Debit:debit,Credit:credit,Balance:balance,Status:status,
  'Reversal Of':reversalOf,_rowIndex:row
});
const sample=()=>({
  shopId:'SHOP-A',bankAccounts:[A()],
  bankBook:[
    B('BB-000001','BA-000001','Bank Charge','FEE','10.00','','90.00',2),
    B('BB-000002','BA-000001','Interest Received','INTEREST','','4.00','94.00',3)
  ]
});
const audit=auditBankMasterSourceBalance;
const codes=r=>r.blockers.map(x=>x.code);
const blocked=(input,code)=>{
  const report=audit(input);
  assert.equal(report.candidateReady,false,JSON.stringify(report));
  assert(codes(report).includes(code),JSON.stringify({code,report}));
  assert.equal(report.historicalSourceVerified,false);
  assert.equal(report.bankAccountOwnershipVerified,false);
  assert.equal(report.d1Reconciled,false);
  assert.equal(report.moneyPostingAuthorized,false);
  return report;
};
test('original Bank Book Debit out/Credit in, exact current and posting running balance',()=>{
  const input=sample(),original=structuredClone(input);
  assert.deepEqual(audit(input),{
    candidateReady:true,
    counts:{bankAccounts:1,bankBookRows:2,openingBackfillRows:0,
      pairedReversals:0,unpairedVoids:0,supplierPaymentBankRows:0},
    blockers:[],
    historicalSourceVerified:false,bankAccountOwnershipVerified:false,
    d1Reconciled:false,moneyPostingAuthorized:false
  });
  assert.deepEqual(input,original);
});
test('late Bank opening backfill is explanatory and cannot double-count opening money',()=>{
  const x=sample();
  x.bankBook.push(B('BB-OPEN','BA-000001','Opening Balance','BA-000001',
    '','100.00','100.00',4));
  const r=audit(x);
  assert.equal(r.candidateReady,true);
  assert.equal(r.counts.openingBackfillRows,1);
});
test('no bank backfill entry is valid source fallback to master Opening Balance',()=>{
  const x=sample();
  assert.equal(audit(x).candidateReady,true);
  assert.equal(audit(x).counts.openingBackfillRows,0);
});
test('one account Bank Book cannot appear on another account merely by similar name',()=>{
  const x=sample();x.bankBook[0]['Bank Account ID']='BA-UNKNOWN';
  blocked(x,'BANK_BOOK_ACCOUNT_MISSING');
});
test('two bank accounts are independent with identical display name and independent balances',()=>{
  const x=sample();
  x.bankAccounts.push({...A('BA-000002','50.00','40.00',3)});
  x.bankBook.push(B('BB-OTHER','BA-000002','Bank Charge','FEE2','10.00','','40.00',4));
  assert.equal(audit(x).candidateReady,true);
  assert.deepEqual(audit(x).counts,{bankAccounts:2,bankBookRows:3,
    openingBackfillRows:0,pairedReversals:0,unpairedVoids:0,supplierPaymentBankRows:0});
});
test('inactive bank master is still retained in historical books, never excluded',()=>{
  const x=sample();x.bankAccounts[0].Status='Inactive';
  assert.equal(audit(x).candidateReady,true);
});
test('bank posting source row array order does not affect original physical append arithmetic',()=>{
  const x=sample();x.bankBook.reverse();
  assert.equal(audit(x).candidateReady,true);
});
test('one-paisa mismatch in stored Bank Current Balance is blocked',()=>{
  const x=sample();x.bankAccounts[0]['Current Balance']='93.99';
  blocked(x,'BANK_CURRENT_BALANCE_MISMATCH');
});
test('altered Bank Book running Balance fails closed',()=>{
  const x=sample();x.bankBook[0].Balance='89.99';
  blocked(x,'BANK_STORED_POSTING_BALANCE_MISMATCH');
});
test('posted mirror reversal counts original out and opposite in, without deleting history',()=>{
  const x={
    shopId:'SHOP-A',
    bankAccounts:[A('BA-000001','100.00','100.00')],
    bankBook:[
      B('BB-CHARGE','BA-000001','Bank Charge','FEE','10.00','','90.00',2,'Reversed'),
      B('BB-REV','BA-000001','Reversal','BB-CHARGE','','10.00','100.00',3,'Active','BB-CHARGE')
    ]
  };
  const r=audit(x);
  assert.equal(r.candidateReady,true,JSON.stringify(r));
  assert.equal(r.counts.pairedReversals,1);
});
test('direct void without linked reversal does NOT remain current money and requires source deletion provenance',()=>{
  const x=sample();
  x.bankAccounts[0]['Current Balance']='104.00';
  x.bankBook[0].Status='Reversed';
  blocked(x,'BANK_VOID_PROVENANCE_UNVERIFIED');
});
test('unpaired Reversal Of mirror cannot fabricate offsetting money',()=>{
  const x=sample();x.bankBook.push(B('BB-REV','BA-000001','Reversal','BB-UNKNOWN',
    '','10.00','104.00',4,'Active','BB-UNKNOWN'));
  blocked(x,'BANK_REVERSAL_TARGET_MISSING');
});
test('reversal on wrong Bank Account is forbidden even with valid source Entry ID',()=>{
  const x=sample();
  x.bankAccounts.push(A('BA-000002','0.00','10.00',3));
  x.bankBook[0].Status='Reversed';
  x.bankBook.push(B('BB-REV','BA-000002','Reversal','BB-000001',
    '','10.00','10.00',4,'Active','BB-000001'));
  blocked(x,'BANK_REVERSAL_ACCOUNT_MISMATCH');
});
test('same bank entry cannot be reversed twice',()=>{
  const x=sample();x.bankBook[0].Status='Reversed';
  x.bankBook.push(B('BB-REV-A','BA-000001','Reversal','BB-000001',
    '','10.00','104.00',4,'Active','BB-000001'));
  x.bankBook.push(B('BB-REV-B','BA-000001','Reversal','BB-000001',
    '','10.00','114.00',5,'Active','BB-000001'));
  blocked(x,'BANK_REVERSAL_DUPLICATE_TARGET');
});
test('reversal must have exact opposite debit and credit amounts',()=>{
  const x=sample();x.bankBook[0].Status='Reversed';
  x.bankBook.push(B('BB-REV','BA-000001','Reversal','BB-000001',
    '','9.99','103.99',4,'Active','BB-000001'));
  blocked(x,'BANK_REVERSAL_AMOUNT_MISMATCH');
});
test('reversal original must be Reversed, mirror Active and source Type=Reversal',()=>{
  const x=sample();
  x.bankBook.push(B('BB-REV','BA-000001','Reversal','BB-000001',
    '','10.00','104.00',4,'Active','BB-000001'));
  blocked(x,'BANK_REVERSAL_ORIGINAL_STATUS_INVALID');
  const y=sample();y.bankBook[0].Status='Reversed';
  y.bankBook.push(B('BB-REV','BA-000001','Reversal','BB-000001',
    '','10.00','104.00',4,'Reversed','BB-000001'));
  blocked(y,'BANK_REVERSAL_MIRROR_STATUS_INVALID');
  const z=sample();z.bankBook[0].Status='Reversed';
  z.bankBook.push(B('BB-REV','BA-000001','Bank Charge','BB-000001',
    '','10.00','104.00',4,'Active','BB-000001'));
  blocked(z,'BANK_REVERSAL_TYPE_INVALID');
});
test('backfill reference and amount must match exact original bank master opening',()=>{
  const x=sample();x.bankBook.push(B('BB-OPEN','BA-000001',
    'Opening Balance','BA-OTHER','','100.00','100.00',4));
  blocked(x,'BANK_OPENING_REFERENCE_MISMATCH');
  const y=sample();y.bankBook.push(B('BB-OPEN','BA-000001',
    'Opening Balance','BA-000001','','99.99','100.00',4));
  blocked(y,'BANK_OPENING_AMOUNT_MISMATCH');
  const z=sample();z.bankBook.push(B('BB-OPEN','BA-000001',
    'Opening Balance','BA-000001','','100.00','99.99',4));
  blocked(z,'BANK_OPENING_BALANCE_MISMATCH');
});
test('second opening backfill for same account must not double-count or pass',()=>{
  const x=sample();
  x.bankBook.push(B('BB-OPEN1','BA-000001','Opening Balance','BA-000001','','100.00','100.00',4));
  x.bankBook.push(B('BB-OPEN2','BA-000001','Opening Balance','BA-000001','','100.00','100.00',5));
  blocked(x,'BANK_OPENING_DUPLICATE');
});
test('all Bank Account/Book exact IDs and original physical rows must be unique',()=>{
  const x=sample();x.bankAccounts.push({...x.bankAccounts[0],_rowIndex:4});
  blocked(x,'BANK_ACCOUNT_SOURCE_ID_DUPLICATE');
  const y=sample();y.bankAccounts.push(A('BA-000002','0.00','0.00',2));
  blocked(y,'BANK_ACCOUNT_ROW_DUPLICATE');
  const z=sample();z.bankBook.push({...z.bankBook[0],_rowIndex:4});
  blocked(z,'BANK_BOOK_SOURCE_ID_DUPLICATE');
  const q=sample();q.bankBook.push(B('BB-NEW','BA-000001','Bank Charge','CHARGE','0.01','','93.99',3));
  blocked(q,'BANK_BOOK_ROW_DUPLICATE');
});
test('noncanonical money including JS numbers, overprecision and unsafe paisa blocks',()=>{
  for(const value of [94,'94.001','9e1',' 94.00 ','90071992547409.92']){
    const x=sample();x.bankAccounts[0]['Current Balance']=value;
    blocked(x,'BANK_MONEY_EVIDENCE_UNSUPPORTED');
  }
});
test('negative bank Current Balance can be represented, opening cannot be invented negative',()=>{
  const x={shopId:'SHOP-A',
    bankAccounts:[A('BA-000001','2.00','-3.00')],
    bankBook:[B('BB-DEBIT','BA-000001','Bank Charge','FEE','5.00','','-3.00',2)]
  };
  assert.equal(audit(x).candidateReady,true);
  x.bankAccounts[0]['Opening Balance']='-2.00';
  blocked(x,'BANK_MONEY_EVIDENCE_UNSUPPORTED');
});
test('unknown Bank Book Status/Account Status and deleted row are review blockers',()=>{
  const x=sample();x.bankBook[0].Status='';
  blocked(x,'BANK_BOOK_STATUS_UNREVIEWED');
  const y=sample();y.bankAccounts[0].Status='Unknown';
  blocked(y,'BANK_ACCOUNT_STATUS_UNREVIEWED');
  const z=sample();z.bankBook[0]['Is Deleted']='TRUE';
  blocked(z,'BANK_BOOK_DELETED_REQUIRES_REVIEW');
});
test('outgoing supplier Bank payment must still reference original Bank Account ID',()=>{
  const x=sample();
  x.bankBook[0].Type='Supplier Payment';x.bankBook[0].Reference='SLD-PAY';
  const r=audit(x);assert.equal(r.candidateReady,true);
  assert.equal(r.counts.supplierPaymentBankRows,1);
});
test('two-sided bank movement and zero-only non-opening movement need review',()=>{
  const x=sample();x.bankBook[0].Credit='1.00';
  blocked(x,'BANK_BOOK_BOTH_SIDES');
  const y=sample();y.bankBook[0].Debit='0';y.bankBook[0].Balance='100.00';
  blocked(y,'BANK_BOOK_ZERO_MOVEMENT_UNREVIEWED');
});
test('malformed inputs fail with a fixed generic message and never disclose IDs',()=>{
  for(const input of [null,{},[],{...sample(),shopId:''},
    {...sample(),bankBook:[null]},{...sample(),bankAccounts:null}]){
    assert.throws(()=>audit(input),e=>e.message==='Historical Bank Account audit unavailable');
  }
  const x=sample();x.bankBook[0].Debit='SECRET_PHONE_01711111111';
  const r=blocked(x,'BANK_MONEY_EVIDENCE_UNSUPPORTED');
  assert.doesNotMatch(JSON.stringify(r),/BA-000001|BB-000001|SECRET|01711111111|100.00|90.00/);
});
test('empty Shop is structural only, never source-authenticated or posting-authorized',()=>{
  const r=audit({shopId:'EMPTY',bankAccounts:[],bankBook:[]});
  assert.equal(r.candidateReady,true);
  assert.equal(r.historicalSourceVerified,false);
  assert.equal(r.moneyPostingAuthorized,false);
});
