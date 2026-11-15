import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceFindSalesByPhone} from './fixtures/m06-phone-history-oracle.mjs';
import {projectSalePhoneHistory} from '../src/modules/sale-phone-history.js';

const clone=x=>JSON.parse(JSON.stringify(x));
function sample(){
  const sale=(id,customerId,phone,createdAt,overrides={})=>({
    'Invoice ID':id,'Customer ID':customerId,'Customer Phone':phone,
    'Customer Name':id+' customer','Date':'2026-11-14T00:00:00',
    'Time':'1899-12-30T17:35:01','Grand Total':100,
    'Due Amount':25,'Payment Status':'Due','Is Deleted':'FALSE',
    'Created At':createdAt,...overrides
  });
  return {
    saleRows:[
      sale('INV-1','CUS-1','01712345678','2026-11-15T10:00:00'),
      sale('INV-2','CUS-2','+8801712345678','2026-11-15T12:00:00',{
        'Due Amount':0,'Payment Status':'Paid'}),
      sale('INV-3','CUS-1','01800000000','2026-11-14T15:00:00'),
      sale('INV-DUP','CUS-1','01712345678','2026-11-15T09:00:00'),
      sale('INV-DUP','CUS-1','01712345678','2026-11-15T08:00:00'),
      sale('INV-DEL','CUS-1','01712345678','2026-11-15T13:00:00',{
        'Is Deleted':'TRUE'}),
      sale('INV-OTHER','CUS-3','01998765432','2026-11-15T14:00:00')
    ],
    ledgerRows:[{'Customer ID':'CUS-1','Type':'Payment','Reference':'INV-1'}],
    returnRows:[],
    settlementStatusByInvoice:{
      'INV-1':'Paid','INV-3':'Partial','INV-DUP':'Paid','INV-2':'Due'
    }
  };
}
function parity(query,fixture=sample()){
  const old=sourceFindSalesByPhone(query,clone(fixture));
  assert.equal(old.success,true,JSON.stringify(old));
  const before=clone(fixture);
  const result=projectSalePhoneHistory(query,fixture);
  assert.deepEqual(clone(result),old.data);
  assert.deepEqual(fixture,before,'pure read must never mutate trusted rows');
  return result;
}

test('Bangladesh mobile local, +880, 880 and Bangla-digit spellings match native source',()=>{
  for(const phone of ['01712345678','1712345678','+880 1712-345678',
    '8801712345678','০১৭১২৩৪৫৬৭৮']){
    const found=parity({phone,customerId:''});
    assert.deepEqual(found.map(x=>x.invoiceId),['INV-2','INV-1','INV-DUP','INV-DUP'],phone);
  }
});

test('exact Customer ID adds that customer’s other-phone history without reassignment',()=>{
  const found=parity({phone:'01712345678',customerId:'CUS-1'});
  assert.ok(found.some(x=>x.invoiceId==='INV-3'));
  assert.ok(found.some(x=>x.invoiceId==='INV-2'));
  assert.equal(found.length,5);
});

test('a different Customer ID is not silently resolved from a shared phone',()=>{
  const found=parity({phone:'01712345678',customerId:'CUS-9'});
  assert.ok(!found.some(x=>x.invoiceId==='INV-3'));
  assert.equal(found.length,4);
});

test('duplicate active Invoice IDs stay visible but are flagged and never get inferred settlement',()=>{
  const found=parity({phone:'01712345678'});
  const duplicates=found.filter(x=>x.invoiceId==='INV-DUP');
  assert.equal(duplicates.length,2);
  assert.ok(duplicates.every(x=>x.duplicateInvoiceId===true));
  assert.ok(duplicates.every(x=>x.paymentStatus==='Due'));
});

test('later customer settlement modifies status only for eligible due invoices',()=>{
  const found=parity({phone:'01712345678',customerId:'CUS-1'});
  assert.equal(found.find(x=>x.invoiceId==='INV-1').paymentStatus,'Paid');
  assert.equal(found.find(x=>x.invoiceId==='INV-3').paymentStatus,'Partial');
  assert.equal(found.find(x=>x.invoiceId==='INV-2').paymentStatus,'Paid');
});

test('no settlement status provided retains original source payment status',()=>{
  const fixture=sample();fixture.settlementStatusByInvoice={};
  const found=parity({phone:'01712345678',customerId:'CUS-1'},fixture);
  assert.equal(found.find(x=>x.invoiceId==='INV-1').paymentStatus,'Due');
});

test('source exact time and date projections retain native printed keys',()=>{
  const found=parity({phone:'01712345678'});
  const row=found.find(x=>x.invoiceId==='INV-1');
  assert.deepEqual(row,{
    invoiceId:'INV-1',date:'2026-11-14',time:'17:35:01',
    customerName:'INV-1 customer',grandTotal:100,
    paymentStatus:'Paid',duplicateInvoiceId:false
  });
});

test('deleted sales excluded before duplicate detection and newest-first ordering',()=>{
  const fixture=sample();
  fixture.saleRows[4]['Is Deleted']='TRUE';
  const found=parity({phone:'01712345678'},fixture);
  assert.equal(found.filter(x=>x.invoiceId==='INV-DUP').length,1);
  assert.equal(found.find(x=>x.invoiceId==='INV-DUP').duplicateInvoiceId,false);
  assert.ok(!found.some(x=>x.invoiceId==='INV-DEL'));
  assert.deepEqual(found.map(x=>x.invoiceId),['INV-2','INV-1','INV-DUP']);
});

test('source does not match a substring phone number',()=>{
  assert.deepEqual(parity({phone:'171234'}),[]);
});

test('unknown phone returns an empty, authorized source result',()=>{
  assert.deepEqual(parity({phone:'01600000000'}),[]);
});

test('blank phone refuses lookup even when a valid Customer ID is given',()=>{
  const source=sourceFindSalesByPhone({phone:'',customerId:'CUS-1'},sample());
  assert.deepEqual(source,{success:false,message:'Enter a phone number.'});
  assert.throws(()=>projectSalePhoneHistory({phone:'',customerId:'CUS-1'},sample()),
    /Enter a phone number/);
});

test('missing trusted source rows or settlement read evidence must fail closed',()=>{
  assert.throws(()=>projectSalePhoneHistory({phone:'01712345678'},null),
    /trusted|snapshot/i);
  assert.throws(()=>projectSalePhoneHistory({phone:'01712345678'},{saleRows:[]}),
    /trusted|snapshot/i);
  assert.throws(()=>projectSalePhoneHistory(null,sample()),
    /query|phone/i);
});

test('source projection preserves no private ledger rows or Customer ID in result',()=>{
  const found=parity({phone:'01712345678',customerId:'CUS-1'});
  for(const row of found){
    assert.deepEqual(Object.keys(row).sort(),[
      'customerName','date','duplicateInvoiceId','grandTotal','invoiceId',
      'paymentStatus','time'
    ].sort());
  }
});
