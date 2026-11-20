/**
 * M02 historical Supplier gross balance — synthetic, offline source evidence.
 * No real source export, production D1, ledger posting or approval.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditHistoricalSupplierGrossLedger} from '../src/party/m02-historical-supplier-gross-ledger.js';

const S=(id,opening,due,row=2)=>({
  'Supplier ID':id,'Supplier Name':'Identical Supplier','Phone':'01700000000',
  'Opening Balance':opening,'Current Due':due,_rowIndex:row,Status:'Active'
});
const L=(id,sid,row,type,debit,credit,balance,reference)=>({
  'Ledger ID':id,'Supplier ID':sid,_rowIndex:row,Type:type,
  Reference:reference,Debit:debit,Credit:credit,Balance:balance
});
const sample=()=>({
  shopId:'SHOP-1',
  suppliers:[S('SUP-000001','10.00','12.50')],
  supplierLedger:[
    L('SLD-000001','SUP-000001',2,'Opening Balance','10.00','','10.00','SUP-000001'),
    L('SLD-000002','SUP-000001',3,'Purchase','5.00','','15.00','PUR-000001'),
    L('SLD-000003','SUP-000001',4,'Payment','','2.50','12.50','PAYMENT')
  ]
});
const audit=auditHistoricalSupplierGrossLedger;
const codes=x=>x.blockers.map(y=>y.code);
const blocked=(input,code)=>{
  const r=audit(input);
  assert.equal(r.candidateReady,false);
  assert.ok(codes(r).includes(code),JSON.stringify(r));
  return r;
};

test('exact Supplier opening, purchase Debit and payment Credit reconcile with no posting',()=>{
  const x=sample(),old=structuredClone(x);
  assert.deepEqual(audit(x),{
    candidateReady:true,
    counts:{suppliers:1,ledgerRows:3,payables:1,credits:0},
    blockers:[],
    historicalSourceVerified:false,d1Reconciled:false,postingAuthorized:false
  });
  assert.deepEqual(x,old,'offline auditor never modifies original rows');
});
test('negative opening/current due stays Supplier credit; two identities never net by phone/name',()=>{
  const x=sample();
  x.suppliers.push(S('SUP-000002','-5.00','-5.00',3));
  x.supplierLedger.push(L('SLD-000004','SUP-000002',5,
    'Opening Balance','','5.00','-5.00','SUP-000002'));
  assert.deepEqual(audit(x).counts,{suppliers:2,ledgerRows:4,payables:1,credits:1});
  assert.equal(audit(x).candidateReady,true);
});
test('exact decimal lexical evidence detects one paisa mismatch in Supplier stored due',()=>{
  const x=sample();x.suppliers[0]['Current Due']='12.49';
  blocked(x,'SUPPLIER_CURRENT_DUE_MISMATCH');
});
test('persisted per-row ledger Balance mismatch cannot be concealed by a correct header',()=>{
  const x=sample();x.supplierLedger[1].Balance='14.99';
  blocked(x,'LEDGER_RUNNING_BALANCE_MISMATCH');
});
test('physical source row index determines append ledger order, not JSON ordering',()=>{
  const x=sample(),prior=structuredClone(x);
  x.supplierLedger.reverse();
  assert.deepEqual(audit(x),audit(prior));
  assert.equal(audit(x).candidateReady,true);
});
test('source IDs and original physical row indices must both be unique within group',()=>{
  const a=sample();a.suppliers.push({...a.suppliers[0],_rowIndex:3});
  blocked(a,'DUPLICATE_SUPPLIER_ID');
  const b=sample();b.suppliers.push(S('SUP-000002','0','0',2));
  blocked(b,'DUPLICATE_SUPPLIER_SHEET_ROW');
  const c=sample();c.supplierLedger.push({...c.supplierLedger[2],_rowIndex:5});
  blocked(c,'DUPLICATE_LEDGER_ID');
  const d=sample();d.supplierLedger.push(L('SLD-009','SUP-000001',3,'Payment','','0','12.50','PAYMENT'));
  blocked(d,'DUPLICATE_LEDGER_SHEET_ROW');
});
test('no missing, coerced or wrong-Supplier Ledger source link is repaired by matching names',()=>{
  const a=sample();a.supplierLedger[1]['Supplier ID']='SUP-UNKNOWN';
  blocked(a,'LEDGER_SUPPLIER_MISSING');
  const b=sample();b.supplierLedger[1]['Supplier ID']=' SUP-000001 ';
  blocked(b,'LEDGER_SUPPLIER_MISSING');
});
test('opening ledger Reference must preserve exact Supplier source ID',()=>{
  const x=sample();x.supplierLedger[0].Reference='SUP-000002';
  blocked(x,'OPENING_BALANCE_REFERENCE_MISMATCH');
});
test('opening ledger sign and sum must reconcile the original master Opening Balance',()=>{
  const x=sample();x.suppliers[0]['Opening Balance']='9.00';
  blocked(x,'OPENING_BALANCE_MISMATCH');
});
test('unproven nonzero opening row is quarantined rather than guessed',()=>{
  const x=sample();x.supplierLedger.shift();
  blocked(x,'OPENING_LEDGER_UNVERIFIED');
});
test('nonzero Current Due without any historical ledger is an explicit blocker',()=>{
  const x=sample();x.supplierLedger=[];
  blocked(x,'SUPPLIER_WITHOUT_LEDGER');
});
test('numeric JS value is not accepted as safe exact historic paisa evidence',()=>{
  const a=sample();a.suppliers[0]['Current Due']=12.5;
  blocked(a,'SUPPLIER_MONEY_EVIDENCE_UNSUPPORTED');
  const b=sample();b.supplierLedger[1].Debit=5;
  blocked(b,'LEDGER_MONEY_EVIDENCE_UNSUPPORTED');
});
test('fractional value over 2 places, exponent, whitespace, negative zero and overflow fail closed',()=>{
  for(const value of ['0.005','1e3',' 2.50 ','-0','90071992547409.92']){
    const x=sample();x.supplierLedger[1].Debit=value;
    blocked(x,'LEDGER_MONEY_EVIDENCE_UNSUPPORTED');
  }
});
test('negative Debit/Credit and dual-sided ledger record are never assumed valid',()=>{
  const a=sample();a.supplierLedger[1].Debit='-5.00';
  blocked(a,'NEGATIVE_LEDGER_SIDE');
  const b=sample();b.supplierLedger[1].Credit='1.00';
  blocked(b,'DOUBLE_SIDED_LEDGER_ROW');
});
test('deleted historical ledger cannot disappear silently from reconciliation',()=>{
  const x=sample();x.supplierLedger[1]['Is Deleted']='TRUE';
  blocked(x,'DELETED_LEDGER_REQUIRES_REVIEW');
});
test('inactive historical Supplier is still retained with original exact ledger provenance',()=>{
  const x=sample();x.suppliers[0].Status='Inactive';x.suppliers[0]['Is Deleted']='TRUE';
  assert.equal(audit(x).candidateReady,true);
  assert.equal(audit(x).counts.suppliers,1);
});
test('empty Shop is a possible structural candidate, never verified historical import',()=>{
  const x={shopId:'SHOP-EMPTY',suppliers:[],supplierLedger:[]};
  const r=audit(x);
  assert.equal(r.candidateReady,true);
  assert.equal(r.historicalSourceVerified,false);
  assert.equal(r.postingAuthorized,false);
});
test('invalid rows, missing physical provenance, missing type and exact IDs fail closed',()=>{
  const a=sample();a.supplierLedger[0]._rowIndex=0;
  blocked(a,'LEDGER_ROW_PROVENANCE_INVALID');
  const b=sample();b.suppliers[0]._rowIndex=1;
  blocked(b,'SUPPLIER_ROW_PROVENANCE_INVALID');
  const c=sample();c.supplierLedger[0].Type='';
  blocked(c,'LEDGER_TYPE_REQUIRED');
  const d=sample();d.suppliers[0]['Supplier ID']='';
  blocked(d,'SUPPLIER_ID_REQUIRED');
  const e=sample();e.supplierLedger[1]['Ledger ID']='';
  blocked(e,'LEDGER_ID_REQUIRED');
});
test('malformed shape throws fixed generic message, never source identifiers',()=>{
  for(const x of [null,{},[],{...sample(),shopId:''},
    {...sample(),suppliers:null},{...sample(),supplierLedger:[null]}]){
    assert.throws(()=>audit(x),e=>e.message==='Historical Supplier ledger audit unavailable');
  }
});
test('redacted output never leaks Supplier names, IDs, phones, or money text',()=>{
  const x=sample();x.supplierLedger[1].Balance='SECRET_01700000000';
  const r=blocked(x,'LEDGER_MONEY_EVIDENCE_UNSUPPORTED');
  assert.doesNotMatch(JSON.stringify(r),/SUP-000001|SLD-000001|Identical|01700000000|SECRET|12.50/);
});
