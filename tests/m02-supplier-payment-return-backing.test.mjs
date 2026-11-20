/**
 * M02 Run 11 — source-anchored, read-only Supplier money provenance.
 * Synthetic inputs only; NEVER real money authorization, import or D1 writes.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditSupplierPaymentReturnBacking} from '../src/party/m02-supplier-payment-return-backing.js';

const supplierId='SUP-000001',purchaseId='PUR-000001';
const S=(id=supplierId,row=2)=>({
  'Supplier ID':id,'Supplier Name':'Identical Supplier Name',
  'Phone':'01711111111',_rowIndex:row
});
const P=(id=purchaseId,sid=supplierId,row=2)=>({
  'Purchase ID':id,'Supplier ID':sid,_rowIndex:row
});
const R=(id,method,money,row)=>({
  'Return ID':id,'Purchase ID':purchaseId,'Supplier ID':supplierId,
  'Refund Method':method,'Total Return Amount':money,_rowIndex:row
});
const L=(id,type,ref,debit,credit,row)=>({
  'Ledger ID':id,'Supplier ID':supplierId,Type:type,Reference:ref,
  Debit:debit,Credit:credit,_rowIndex:row
});
const C=(id,type,ref,debit,credit,row)=>({
  'Entry ID':id,Type:type,Reference:ref,Debit:debit,Credit:credit,_rowIndex:row
});
const base=()=>({
  shopId:'SHOP-001',
  suppliers:[S()],
  purchases:[P()],
  purchaseReturns:[
    R('RET-CASH','Cash','1.20',2),
    R('RET-CREDIT','Supplier Credit','2.00',3)
  ],
  supplierLedger:[
    {...L('SLD-PAY','Payment','PAYMENT','','5.00',2),
      'Payment Method':'Cash','Payment Amount':'5.00',
      'Discount Amount':'','Discount Reason':''},
    L('SLD-CREDIT','Purchase Return Credit','RET-CREDIT','','2.00',3)
  ],
  cashBook:[
    {...C('CASH-PAY','Supplier Payment','SLD-PAY','5.00','',2),
      'Payment Method':'Cash'},
    {...C('CASH-RETURN','Purchase Return','RET-CASH','','1.20',3),
      'Payment Method':'Cash'}
  ],
  bankBook:[]
});
const audit=auditSupplierPaymentReturnBacking;
const codes=x=>x.blockers.map(y=>y.code);
const blocked=(x,code)=>{
  const r=audit(x);
  assert.equal(r.candidateReady,false,JSON.stringify(r));
  assert(codes(r).includes(code),JSON.stringify({expected:code,got:r}));
  assert.equal(r.sourceAuthenticityVerified,false);
  assert.equal(r.cashAdvanceAllocationVerified,false);
  assert.equal(r.cashRefundEntitlementVerified,false);
  assert.equal(r.postingAuthorized,false);
  return r;
};

test('cash supplier Payment, cash purchase Return and noncash Supplier Credit keep independent provenance',()=>{
  const x=base(),copy=structuredClone(x);
  assert.deepEqual(audit(x),{
    candidateReady:true,
    counts:{
      supplierPaymentRows:1,cashPaymentLegs:1,bankPaymentLegs:0,
      cashReturnRefunds:1,noncashSupplierCreditReturns:1,
      discountsRequiringReview:0
    },
    blockers:[],
    sourceAuthenticityVerified:false,
    cashAdvanceAllocationVerified:false,
    cashRefundEntitlementVerified:false,
    postingAuthorized:false
  });
  assert.deepEqual(x,copy,'read-only audit must not mutate original rows');
});
test('bank Supplier Payment matches original Ledger ID and separate bank account, not Cash Book',()=>{
  const x=base();x.supplierLedger[0]['Payment Method']='Bank';
  x.bankBook=[{...x.cashBook.shift(),'Entry ID':'BANK-1','Bank Account ID':'BA-1',Status:'Active'}];
  const r=audit(x);
  assert.equal(r.candidateReady,true);
  assert.equal(r.counts.bankPaymentLegs,1);
  assert.equal(r.counts.cashPaymentLegs,0);
});
test('Mobile Banking uses bank-like book backing rather than assumed Cash Book',()=>{
  const x=base();x.supplierLedger[0]['Payment Method']='Mobile Banking';
  x.bankBook=[{...x.cashBook.shift(),'Entry ID':'BANK-MOBILE','Bank Account ID':'BA-2'}];
  assert.equal(audit(x).candidateReady,true);
});
test('source discount is never falsely classified as money or authorized without separate audit',()=>{
  const x=base();
  x.supplierLedger[0]['Payment Amount']='4.00';
  x.supplierLedger[0]['Discount Amount']='1.00';
  x.supplierLedger[0]['Discount Reason']='Owner discount approval reference';
  x.cashBook[0].Debit='4.00';
  const r=blocked(x,'DISCOUNT_AUTHORITY_UNVERIFIED');
  assert.equal(r.counts.discountsRequiringReview,1);
  assert.equal(r.counts.cashPaymentLegs,1);
  const y=structuredClone(x);y.supplierLedger[0]['Discount Reason']='';
  blocked(y,'DISCOUNT_REASON_REQUIRED');
});
test('ledger Credit must equal actual Payment Amount plus Discount Amount exactly',()=>{
  const x=base();x.supplierLedger[0].Credit='4.99';
  blocked(x,'PAYMENT_TOTAL_NOT_CONSERVED');
});
test('ledger Payment Amount without exact matching cash receipt stays unverified',()=>{
  const x=base();x.cashBook.shift();
  blocked(x,'PAYMENT_MONEY_BACKING_MISSING');
});
test('older Supplier ID-based book references are not automatically attributed by name or date',()=>{
  const x=base();x.cashBook[0].Reference=supplierId;
  blocked(x,'PAYMENT_MONEY_BACKING_MISSING');
  blocked(x,'ORPHAN_SUPPLIER_PAYMENT_BOOK');
});
test('blank historical Payment Method cannot create a verified cash-backed advance',()=>{
  const x=base();x.supplierLedger[0]['Payment Method']='';
  blocked(x,'LEGACY_PAYMENT_METHOD_UNVERIFIED');
});
test('missing original Payment Amount cannot silently equal the ledger Credit',()=>{
  const x=base();x.supplierLedger[0]['Payment Amount']='';
  blocked(x,'PAYMENT_AMOUNT_UNATTRIBUTED');
});
test('bank-like method cannot be backed by a cash-only leg or wrong book',()=>{
  const x=base();x.supplierLedger[0]['Payment Method']='Bank';
  blocked(x,'PAYMENT_MONEY_BOOK_MISMATCH');
});
test('duplicate cash/bank reference legs cannot each claim the same Supplier payment',()=>{
  const x=base();x.cashBook.push({...C('CASH-DUP','Supplier Payment','SLD-PAY','5.00','',4)});
  blocked(x,'DUPLICATE_SUPPLIER_PAYMENT_LEG');
});
test('cash book Supplier Payment must be Debit outgoing, not Credit incoming',()=>{
  const x=base();x.cashBook[0].Debit='';x.cashBook[0].Credit='5.00';
  blocked(x,'SUPPLIER_PAYMENT_BOOK_AMOUNT_MISMATCH');
});
test('bank Book active account, status and reversal evidence must be explicit',()=>{
  const x=base();x.supplierLedger[0]['Payment Method']='Bank';
  x.bankBook=[{...x.cashBook.shift(),'Entry ID':'BANK-1','Bank Account ID':'',Status:'Active'}];
  blocked(x,'BANK_ACCOUNT_ID_REQUIRED');
  x.bankBook[0]['Bank Account ID']='BA-1';
  x.bankBook[0].Status='Reversed';
  blocked(x,'REVERSED_BANK_ENTRY_REQUIRES_REVIEW');
  x.bankBook[0].Status='Active';x.bankBook[0]['Reversal Of']='BANK-OLD';
  blocked(x,'REVERSED_BANK_ENTRY_REQUIRES_REVIEW');
});
test('original Cash purchase return means money IN as Cash Book Credit, not Supplier Ledger credit',()=>{
  const x=base();x.cashBook[1].Credit='';x.cashBook[1].Debit='1.20';
  blocked(x,'CASH_RETURN_REFUND_MISMATCH');
});
test('Cash return requires matching booked receipt and never issues a fake refund from ledger alone',()=>{
  const x=base();x.cashBook.pop();
  blocked(x,'CASH_RETURN_REFUND_MISSING');
});
test('Supplier Credit return requires exact Ledger ID, Return ID, Supplier and amount',()=>{
  const x=base();x.supplierLedger[1].Credit='1.99';
  blocked(x,'RETURN_CREDIT_LEDGER_MISMATCH');
  const y=base();y.supplierLedger[1].Reference='RET-CASH';
  blocked(y,'SUPPLIER_CREDIT_LEDGER_MISSING');
});
test('Supplier Credit does not also create Cash/Bank book movement',()=>{
  const x=base();x.cashBook.push(C('CASH-IMPROPER','Purchase Return','RET-CREDIT','','2.00',4));
  blocked(x,'NONCASH_RETURN_HAS_MONEY_BOOK');
});
test('cash Return does not also create Supplier Ledger credit',()=>{
  const x=base();x.supplierLedger.push(L('SLD-BOTH','Purchase Return Credit','RET-CASH','','1.20',4));
  blocked(x,'CASH_RETURN_HAS_NONCASH_LEDGER');
});
test('Purchase Return must link exact original Purchase and Supplier ID',()=>{
  const x=base();x.purchaseReturns[0]['Purchase ID']='PUR-LOST';
  blocked(x,'RETURN_PURCHASE_REFERENCE_MISSING');
  const y=base();y.purchaseReturns[0]['Supplier ID']='SUP-OTHER';
  blocked(y,'RETURN_SUPPLIER_MISMATCH');
});
test('unmatched supplier payment and cash refund book entries are quarantined',()=>{
  const x=base();x.cashBook.push(C('CASH-ORPHAN','Supplier Payment','SLD-OTHER','1.00','',4));
  blocked(x,'ORPHAN_SUPPLIER_PAYMENT_BOOK');
  const y=base();y.cashBook.push(C('CASH-ORPHAN','Purchase Return','RET-OTHER','','1.00',4));
  blocked(y,'ORPHAN_PURCHASE_REFUND_BOOK');
});
test('orphan noncash Return Credit source Ledger is never used to net due',()=>{
  const x=base();x.supplierLedger.push(L('SLD-ORPHAN','Purchase Return Credit','RET-OTHER','','5.00',4));
  blocked(x,'ORPHAN_SUPPLIER_RETURN_CREDIT');
});
test('unknown payment and Return refund methods must not be inferred',()=>{
  const x=base();x.supplierLedger[0]['Payment Method']='Cheque';
  blocked(x,'PAYMENT_METHOD_UNSUPPORTED');
  const y=base();y.purchaseReturns[0]['Refund Method']='Bank';
  blocked(y,'RETURN_REFUND_METHOD_UNREVIEWED');
});
test('deleted source ledger, book and return rows remain review blockers',()=>{
  const x=base();x.supplierLedger[0]['Is Deleted']='TRUE';
  blocked(x,'DELETED_SUPPLIER_LEDGER_REQUIRES_REVIEW');
  const y=base();y.cashBook[0]['Is Deleted']=true;
  blocked(y,'DELETED_MONEY_BOOK_REQUIRES_REVIEW');
  const z=base();z.purchaseReturns[0]['Is Deleted']='TRUE';
  blocked(z,'DELETED_PURCHASE_RETURN_REQUIRES_REVIEW');
});
test('duplicate source IDs and physical row indices fail closed independently in each group',()=>{
  const x=base();x.cashBook.push({...x.cashBook[0],_rowIndex:4});
  blocked(x,'DUPLICATE_CASH_BOOK_SOURCE_ID');
  const y=base();y.supplierLedger.push({...L('NEW-ID','Payment','PAYMENT','','0.01',2)});
  blocked(y,'DUPLICATE_SUPPLIER_LEDGER_SHEET_ROW');
  const z=base();z.purchaseReturns.push({...z.purchaseReturns[0],_rowIndex:5});
  blocked(z,'DUPLICATE_PURCHASE_RETURN_SOURCE_ID');
});
test('literal Supplier ID cannot be repaired by matching phone/name',()=>{
  const x=base();x.supplierLedger[0]['Supplier ID']=' SUP-000001 ';
  blocked(x,'PAYMENT_SUPPLIER_REFERENCE_MISSING');
  const y=base();y.suppliers.push(S('SUP-000002',3));
  assert.equal(audit(y).candidateReady,true);
});
test('no numeric rounding, unsafe limits, exponents or precision beyond paisa',()=>{
  for(const v of [5,'5.001','1e3',' 5.00 ','90071992547409.92']){
    const x=base();x.supplierLedger[0]['Payment Amount']=v;
    blocked(x,'PAYMENT_MONEY_EVIDENCE_UNSUPPORTED');
  }
});
test('Cash/Bank book amount and zero-sided source proof cannot include negative value',()=>{
  const x=base();x.cashBook[0].Debit='-5.00';
  blocked(x,'MONEY_BOOK_EVIDENCE_UNSUPPORTED');
  const y=base();y.supplierLedger[0].Debit='1.00';
  blocked(y,'PAYMENT_TOTAL_NOT_CONSERVED');
});
test('row input order never changes deterministic redacted audit; source objects unchanged',()=>{
  const x=base();const copy=structuredClone(x);const r=audit(x);
  for(const k of ['suppliers','purchases','purchaseReturns','supplierLedger','cashBook','bankBook'])
    x[k].reverse();
  assert.deepEqual(audit(x),r);
  assert.deepEqual(copy.suppliers[0],x.suppliers[0]);
});
test('empty independently provided shop has no false authenticity or posting approval',()=>{
  const x={shopId:'SHOP-EMPTY',suppliers:[],purchases:[],purchaseReturns:[],
    supplierLedger:[],cashBook:[],bankBook:[]};
  const r=audit(x);
  assert.equal(r.candidateReady,true);
  assert.equal(r.sourceAuthenticityVerified,false);
  assert.equal(r.cashAdvanceAllocationVerified,false);
  assert.equal(r.postingAuthorized,false);
});
test('malformed source snapshots throw a fixed non-identifying error',()=>{
  for(const input of [null,{},[],{...base(),shopId:''},
    {...base(),supplierLedger:[null]},{...base(),bankBook:null},
    {...base(),purchaseReturns:[42]}]){
    assert.throws(()=>audit(input),e=>e.message==='Supplier money provenance audit unavailable');
  }
});
test('all reports redact source identifiers, phones and financial amounts',()=>{
  const x=base();x.supplierLedger[0]['Payment Amount']='SECRET_PHONE_01711111111';
  const r=blocked(x,'PAYMENT_MONEY_EVIDENCE_UNSUPPORTED');
  assert.doesNotMatch(JSON.stringify(r),
    /SUP-000001|SLD-PAY|RET-CASH|Identical|01711111111|SECRET_PHONE|5.00/);
});
