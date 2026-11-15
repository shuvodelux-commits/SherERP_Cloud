import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNativeLegacySaleUpdateOracle} from './fixtures/m06-legacy-sale-update-oracle.mjs';
import {planLegacySaleUpdatePaymentPreview} from '../src/modules/legacy-sale-update-payment-preview.js';

const oracle=createNativeLegacySaleUpdateOracle();
const original=()=>({
  invoiceId:'INV-LEG-17',
  sale:{'Invoice ID':'INV-LEG-17','Is Deleted':'FALSE',
    'Payment Detail Version':'','Customer ID':'CUS-17',
    'Customer Phone':'01711111111'},
  oldItems:[{'Invoice ID':'INV-LEG-17','Product ID':'PIPE',
    'Quantity':2,'Unit Price':19.99,'Line Total':'39.985'}],
  newItems:[{productId:'PIPE',name:'Pipe',qty:2,unitPrice:19.99}],
  discount:0,
  paymentType:'Cash',
  paidAmount:0,
  paymentMethod:'Cash',
  bankAccountId:'',
  bankAccounts:[
    {'Bank Account ID':'BANK-1','Account Name':'Historic Bank',
      'Account Type':'Bank','Status':'Active','Is Deleted':'FALSE'},
    {'Bank Account ID':'WALLET-1','Account Name':'Mobile Account',
      'Account Type':'Mobile Banking','Status':'Active','Is Deleted':'FALSE'}
  ]
});
function compare(input=original()){
  const before=structuredClone(input);
  const expected=oracle.project(input);
  const actual=planLegacySaleUpdatePaymentPreview(input,{canEditSales:true});
  assert.deepEqual(actual,expected,'Legacy source single-tender output differs');
  assert.deepEqual(input,before,'Legacy edit preview must not mutate source rows');
  return actual;
}
test('Cash sale retains exact original auto-priced line, paid balance and status',()=>{
  const result=compare();
  assert.equal(result.lines[0].lineTotal,39.985);
  assert.equal(result.subtotal,39.99);
  assert.equal(result.grandTotal,39.99);
  assert.equal(result.paidAmount,39.99);
  assert.equal(result.dueAmount,0);
  assert.equal(result.paymentType,'Cash');
  assert.equal(result.paymentStatus,'Paid');
  assert.equal(result.paymentMethod,'Cash');
});
test('Due sale ignores paid input and bank account selection, produces exact due status',()=>{
  const d=original();
  d.paymentType='Due';d.paidAmount=100;d.paymentMethod='Bank';d.bankAccountId='BANK-1';
  const r=compare(d);
  assert.equal(r.paidAmount,0);
  assert.equal(r.dueAmount,39.99);
  assert.equal(r.paymentMethod,'');
  assert.equal(r.bankAccountId,'');
  assert.equal(r.paymentStatus,'Due');
});
test('Partial payment uses raw original paid amount and due arithmetic, not a split allocator',()=>{
  const d=original();d.paymentType='Partial';d.paidAmount=10;
  const r=compare(d);
  assert.equal(r.paidAmount,10);
  assert(Math.abs(r.dueAmount-29.99)<1e-9, 'Original raw Partial due preserves JavaScript floating point precision');
  assert.equal(r.paymentStatus,'Partial');
  assert.equal(r.paymentMethod,'Cash');
});
test('an inactive old Bank account is still allowed for legacy invoice resave',()=>{
  const d=original();
  d.paymentType='Partial';d.paidAmount=10;d.paymentMethod='Bank';
  d.bankAccountId=' BANK-1 ';d.bankAccounts[0].Status='Inactive';
  const r=compare(d);
  assert.equal(r.bankAccountId,'BANK-1');
  assert.equal(r.bankAccountName,'Historic Bank');
  assert.equal(r.paymentMethod,'Bank');
});
test('Mobile Banking uses original account ID/name lookup without imposing split-mode type gate',()=>{
  const d=original();
  d.paymentType='Cash';d.paymentMethod='Mobile Banking';
  d.bankAccountId='WALLET-1';d.bankAccounts[1].Status='Inactive';
  const r=compare(d);
  assert.equal(r.bankAccountId,'WALLET-1');
  assert.equal(r.bankAccountName,'Mobile Account');
  // Original source resolves existing IDs; it does not require type equality.
  d.bankAccountId='BANK-1';
  assert.equal(compare(d).bankAccountId,'BANK-1');
});
test('blank discount acts as zero; changed price and valid discount alter grand total',()=>{
  const d=original();d.discount='';
  assert.equal(compare(d).discount,0);
  d.newItems[0].unitPrice=20;
  d.discount=5;
  const r=compare(d);
  assert.equal(r.lines[0].lineTotal,40);
  assert.equal(r.grandTotal,35);
  assert.equal(r.paidAmount,35);
});
test('discount above subtotal clamps total to zero and produces source Paid classification',()=>{
  const d=original();d.discount=100;
  const r=compare(d);
  assert.equal(r.grandTotal,0);
  assert.equal(r.paidAmount,0);
  assert.equal(r.dueAmount,0);
  assert.equal(r.paymentStatus,'Paid');
  assert.equal(r.paymentMethod,'');
});
test('partial payment must be positive and strictly below adjusted invoice total',()=>{
  for(const value of [0,-1,39.99,40,'bad',Infinity,NaN]){
    const d=original();d.paymentType='Partial';d.paidAmount=value;
    assert.throws(()=>planLegacySaleUpdatePaymentPreview(d,{canEditSales:true}),
      /partial|payment|amount/i);
  }
  const d=original();d.paymentType='Unknown';
  assert.throws(()=>planLegacySaleUpdatePaymentPreview(d,{canEditSales:true}),
    /payment|type|choose/i);
});
test('legacy bank-like tender requires existing bank account but ordinary Cash ignores it',()=>{
  for(const id of ['','UNKNOWN']){
    const d=original();d.paymentMethod='Bank';d.bankAccountId=id;
    assert.throws(()=>oracle.project(d),/bank account/i);
    assert.throws(()=>planLegacySaleUpdatePaymentPreview(d,{canEditSales:true}),/bank account/i);
  }
  const d=original();d.bankAccountId='UNKNOWN';d.paymentMethod='Cash';
  assert.equal(compare(d).bankAccountId,'');
});
test('only unique active legacy invoice is accepted; reject version 1 and mismatched ID',()=>{
  const changes=[
    d=>{d.sale['Payment Detail Version']='1';},
    d=>{d.sale['Payment Detail Version']='2';},
    d=>{d.sale['Is Deleted']='TRUE';},
    d=>{d.sale['Invoice ID']='INV-OTHER';},
    d=>{d.invoiceId='';}
  ];
  for(const change of changes){
    const d=original();change(d);
    assert.throws(()=>planLegacySaleUpdatePaymentPreview(d,{canEditSales:true}),
      /version|deleted|invoice|mismatch/i);
  }
});
test('server edit permission, complete rows and plain-record proof are mandatory',()=>{
  assert.throws(()=>planLegacySaleUpdatePaymentPreview(original()),/permission|authorize/i);
  for(const k of ['sale','oldItems','newItems','bankAccounts']){
    const d=original();delete d[k];
    assert.throws(()=>planLegacySaleUpdatePaymentPreview(d,{canEditSales:true}),
      /trusted|missing|array|record/i);
  }
  const row=original();
  Object.defineProperty(row.bankAccounts[0],'Status',{get:()=> 'Active'});
  assert.throws(()=>planLegacySaleUpdatePaymentPreview(row,{canEditSales:true}),
    /trusted|accessor|record/i);
  const d=original();
  d.sale=Object.create({'Invoice ID':'INV-LEG-17'});
  assert.throws(()=>planLegacySaleUpdatePaymentPreview(d,{canEditSales:true}),
    /trusted|record/i);
});
test('duplicate proposed Product IDs, impossible quantity, negative and nonfinite discounts fail closed',()=>{
  const d=original();d.newItems.push({...d.newItems[0]});
  assert.throws(()=>planLegacySaleUpdatePaymentPreview(d,{canEditSales:true}),/duplicate/i);
  for(const qty of [0,-1,Infinity,NaN]){
    const copy=original();copy.newItems[0].qty=qty;
    assert.throws(()=>planLegacySaleUpdatePaymentPreview(copy,{canEditSales:true}),
      /quantity/i);
  }
  for(const discount of [-1,NaN,Infinity,'garbage']){
    const copy=original();copy.discount=discount;
    assert.throws(()=>planLegacySaleUpdatePaymentPreview(copy,{canEditSales:true}),
      /discount|finite|amount/i);
  }
});
