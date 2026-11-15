import test from 'node:test';
import assert from 'node:assert/strict';
import {nativePosPhoneHistory} from './fixtures/m06-phone-search-oracle.mjs';
import {projectPosPhoneInvoiceHistory} from '../src/modules/pos-invoice-phone-search.js';

const phone='01711111111';
const sale=(id,fields={})=>({
  'Invoice ID':id,Date:'2026-11-15T10:15:00',Time:'1899-12-30T10:15:08',
  'Created At':'2026-11-15T10:20:00','Customer ID':'C-1',
  'Customer Phone':phone,'Customer Name':'Original Customer',
  'Grand Total':250,'Due Amount':100,'Payment Status':'Partial',...fields
});
const base=[
  sale('INV-OLDER',{'Created At':'2026-11-14T19:00:00','Date':'2026-11-12',
    'Customer Phone':'+8801711111111'}),
  sale('INV-NEW',{'Created At':'2026-11-15T11:00:00','Customer Phone':'১৭১১১১১১১১'}),
  sale('INV-WALKIN',{'Created At':'2026-11-15T12:00:00','Customer ID':'',
    'Customer Phone':phone,'Due Amount':0,'Payment Status':'Paid'}),
  sale('INV-OTHER',{'Created At':'2026-11-15T13:00:00','Customer ID':'C-OTHER',
    'Customer Phone':phone,'Customer Name':'Different party','Payment Status':'Due'}),
  sale('INV-ID',{'Created At':'2026-11-15T14:00:00','Customer ID':'C-1',
    'Customer Phone':'01988888888'})
];
const settled={
  'INV-OLDER':{paymentStatus:'Paid'},
  'INV-NEW':{paymentStatus:'Paid'},
  'INV-WALKIN':{paymentStatus:'Refunded'},
  'INV-OTHER':{paymentStatus:'Settled'},
  'INV-ID':{paymentStatus:'Paid'}
};
function result(phoneInput=phone,id='',options={}) {
  const activeSales=options.activeSales??base;
  const currentSettlementByInvoice=options.currentSettlementByInvoice??settled;
  const src=nativePosPhoneHistory({activeSales,settlementByInvoice:currentSettlementByInvoice});
  const expected=src.search(phoneInput,id);
  let actual;
  try{
    actual={success:true,data:projectPosPhoneInvoiceHistory(phoneInput,id,{activeSales,currentSettlementByInvoice})};
  }catch(error){
    actual={success:false,message:error.message};
  }
  assert.deepEqual(actual,expected);
  return {actual,sourceReads:src.reads};
}
test('Bangla digits, +880 and leading-zero formats match source display history',()=>{
  for(const query of [phone,'+8801711111111','1711111111','০১৭১১১১১১১১']){
    const rows=result(query).actual.data;
    assert.equal(rows.length,4);
    assert.equal(rows[0].invoiceId,'INV-OTHER');
    assert.equal(rows[3].invoiceId,'INV-OLDER');
  }
});
test('selected legacy Customer ID adds nonmatching-phone rows without hiding a distinct phone-match identity',()=>{
  const rows=result(phone,'C-1').actual.data;
  assert.equal(rows.length,5);
  assert.equal(rows[0].invoiceId,'INV-ID');
  assert.ok(rows.find(r=>r.customerName==='Different party'));
});
test('history sorts by creation instant, not backdated original sale Date',()=>{
  const rows=result().actual.data;
  assert.equal(rows[3].date,'2026-11-12');
  assert.deepEqual(rows.map(r=>r.invoiceId),['INV-OTHER','INV-WALKIN','INV-NEW','INV-OLDER']);
});
test('eligible tracked due invoices show current settlement status, never source header status',()=>{
  const rows=result(phone,'C-1').actual.data;
  assert.equal(rows.find(r=>r.invoiceId==='INV-OLDER').paymentStatus,'Paid');
  assert.equal(rows.find(r=>r.invoiceId==='INV-NEW').paymentStatus,'Paid');
  assert.equal(rows.find(r=>r.invoiceId==='INV-OTHER').paymentStatus,'Settled');
});
test('walk-in with no Customer ID keeps stored status, even if settlement map provides one',()=>{
  const rows=result().actual.data;
  assert.equal(rows.find(r=>r.invoiceId==='INV-WALKIN').paymentStatus,'Paid');
});
test('duplicate invoice IDs across active sales are flagged and never given a fabricated settlement',()=>{
  const activeSales=[...base,sale('INV-NEW',{'Created At':'2026-11-13T08:00:00',
    'Customer Phone':'01877777777','Customer ID':'C-9','Payment Status':'Due'})];
  const rows=result(phone,'C-9',{activeSales}).actual.data;
  const dup=rows.filter(r=>r.invoiceId==='INV-NEW');
  assert.equal(dup.length,2);
  assert.deepEqual(dup.map(r=>r.duplicateInvoiceId),[true,true]);
  assert.deepEqual(dup.map(r=>r.paymentStatus),['Partial','Due']);
});
test('no-due tracked invoice retains stored status despite a settlement override',()=>{
  const activeSales=[sale('INV-NO-DUE',{'Due Amount':0,'Payment Status':'Paid'})];
  const rows=result(phone,'',{activeSales,currentSettlementByInvoice:{
    'INV-NO-DUE':{paymentStatus:'Wrong'}
  }}).actual.data;
  assert.equal(rows[0].paymentStatus,'Paid');
});
test('threshold 0.004 excludes tiny due, but 0.005 permits source settlement status',()=>{
  const activeSales=[
    sale('INV-LOW',{'Due Amount':0.004,'Payment Status':'Partial'}),
    sale('INV-HIGH',{'Due Amount':0.005,'Payment Status':'Partial'})
  ];
  const rows=result(phone,'',{activeSales,currentSettlementByInvoice:{
    'INV-LOW':{paymentStatus:'Paid'},'INV-HIGH':{paymentStatus:'Paid'}
  }}).actual.data;
  assert.equal(rows.find(r=>r.invoiceId==='INV-LOW').paymentStatus,'Partial');
  assert.equal(rows.find(r=>r.invoiceId==='INV-HIGH').paymentStatus,'Paid');
});
test('unknown phone yields empty history without inventing a new customer',()=>{
  assert.deepEqual(result('01933333333').actual.data,[]);
});
test('blank phone fails even when selected Customer ID exists',()=>{
  for(const p of ['',null,'  ']) {
    const out=result(p,'C-1').actual;
    assert.equal(out.success,false);
    assert.match(out.message,/Enter a phone number/);
  }
});
test('source-shaped invoice time is formatted for POS without the 1899 anchor date',()=>{
  const rows=result().actual.data;
  assert.equal(rows[0].time,'10:15:08');
  assert.ok(rows.every(r=>!r.time.includes('1899')));
});
test('phone history is pure: input Sales, settlement and selected ID remain unchanged',()=>{
  const activeSales=structuredClone(base),currentSettlementByInvoice=structuredClone(settled);
  const before=JSON.stringify({activeSales,currentSettlementByInvoice});
  projectPosPhoneInvoiceHistory(phone,'C-1',{activeSales,currentSettlementByInvoice});
  assert.equal(JSON.stringify({activeSales,currentSettlementByInvoice}),before);
});
test('caller must supply trusted source-shaped active sales and settlement snapshots',()=>{
  assert.throws(()=>projectPosPhoneInvoiceHistory(phone,'',{}),/trusted/i);
  assert.throws(()=>projectPosPhoneInvoiceHistory(phone,'',{activeSales:base}),/trusted/i);
});
