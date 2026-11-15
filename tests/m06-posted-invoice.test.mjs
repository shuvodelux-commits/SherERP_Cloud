import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativePostedInvoiceOracle} from './fixtures/m06-posted-invoice-oracle.mjs';
import {projectPostedInvoice} from '../src/modules/posted-invoice-preview.js';

const invoiceId='INV-000042';
const sale={
  'Invoice ID':invoiceId,Date:'2026-11-15T16:20:00',Time:'1899-12-30T17:35:01',
  'Customer ID':'CUSTOMER-12','Customer Name':'Selected person','Customer Phone':'01700000000',
  'Customer Address':'Dhaka','Customer Relation Type':'Husband','Customer Relation Name':'Original spouse',
  Subtotal:150,Discount:0,'Grand Total':150,'Paid Amount':100,'Due Amount':50,
  'Payment Detail Version':'1','Payment Method':'Multiple','Payment Type':'Partial',
  'Payment Status':'Partial','Bank Account ID':'','Bank Account Name':''
};
const item={'Invoice ID':invoiceId,'Product ID':'P-1','Product Name':'Wire','Quantity':2,
  'Unit Price':75,'Line Total':150,'Supplier ID':'SUP-9','Supplier Name':'Supplier nine'};
const product={'Product ID':'P-1',Unit:'Meter'};
const customer={'Customer ID':'CUSTOMER-12','Father Name':'Current father'};
const bankPayment={'Invoice ID':invoiceId,'Payment ID':'PAY-B','Row Order':1,Revision:1,
  Status:'Active',Method:'Bank','Bank Account ID':'BANK-4','Bank Account Name':'Shop Bank',
  'Tendered Amount':60,'Applied Amount':60,'Change Amount':0};
const cashPayment={'Invoice ID':invoiceId,'Payment ID':'PAY-C','Row Order':2,Revision:1,
  Status:'Active',Method:'Cash','Bank Account ID':'','Bank Account Name':'',
  'Tendered Amount':55,'Applied Amount':40,'Change Amount':15};
const settings={'Shop Name':'Nawab Electrical','Invoice Payment Terms Days':15,
  'Invoice Show Bismillah':'false','Invoice Show Signature':'true',
  'Invoice Title':'চালান','Receipt Size':'80mm'};
const settlement={paidAmount:125,dueAmount:25,customerCreditUsed:0,
  paymentType:'Partial',paymentStatus:'Partial'};
const data=({saleRows=[sale],itemRows=[item],productRows=[product],customerRows=[customer],
  paymentRows=[bankPayment,cashPayment],settings:s=settings,settlement:t=settlement}={})=>
  ({saleRows,itemRows,productRows,customerRows,paymentRows,settings:s,settlement:t});
const plain=x=>JSON.parse(JSON.stringify(x));
const runPair=(input,id=invoiceId)=>{
  const native=createNativePostedInvoiceOracle(input);
  const args={...input,shop:native.shop()};
  let original,ported;
  try{original={ok:true,value:native.invoice(id)}}catch(error){original={ok:false,error:error.message}}
  try{ported={ok:true,value:plain(projectPostedInvoice(id,args))}}catch(error){ported={ok:false,error:error.message}}
  assert.deepEqual(ported,original);
  return ported;
};

test('reprinted split invoice preserves original checkout tender, cash change and later current settlement',()=>{
  const output=runPair(data()).value;
  assert.equal(output.originalPaidAmount,100);
  assert.equal(output.paidAmount,125);
  assert.equal(output.dueAmount,25);
  assert.deepEqual(output.payments.map(p=>[p.method,p.tendered,p.applied,p.change]),[
    ['Bank',60,60,0],['Cash',55,40,15]]);
  assert.equal(output.paymentDetailVersion,'1');
  assert.equal(output.customerId,'CUSTOMER-12');
  assert.equal(output.customerFatherName,'Original spouse');
  assert.equal(output.customerRelationType,'Husband');
});
test('reprint date, print time, payment terms and product unit match native invoice payload',()=>{
  const output=runPair(data()).value;
  assert.equal(output.date,'2026-11-15');
  assert.equal(output.time,'17:35:01');
  assert.equal(output.dueDate,'2026-11-30');
  assert.equal(output.items[0].unit,'Meter');
  assert.equal(output.shop.showBismillah,false);
});
test('unsettled v1 entirely-due invoice may have zero authoritative payment children',()=>{
  const input=data({saleRows:[{...sale,'Paid Amount':0,'Due Amount':150}],
    paymentRows:[],settlement:null});
  const out=runPair(input).value;
  assert.deepEqual(out.payments,[]);
  assert.equal(out.originalPaidAmount,0);
  assert.equal(out.paidAmount,0);
  assert.equal(out.dueAmount,150);
});
test('legacy payment detail version creates display-only synthetic tender, never a real child',()=>{
  const input=data({saleRows:[{...sale,'Payment Detail Version':'','Payment Method':'Bank',
    'Bank Account ID':'BANK-4','Bank Account Name':'Shop Bank'}],paymentRows:[],settlement:null});
  const out=runPair(input).value;
  assert.equal(out.paymentDetailVersion,'');
  assert.deepEqual(out.payments.map(p=>[p.rowId,p.method,p.legacy]),[['legacy','Bank',true]]);
});
test('legacy relation falls back to exact selected customer ID rather than matching phone or name',()=>{
  const input=data({saleRows:[{...sale,'Customer Relation Type':'','Customer Relation Name':''}],
    customerRows:[{'Customer ID':'DIFFERENT','Father Name':'Wrong dad',
      'Phone':'01700000000'},customer]});
  const out=runPair(input).value;
  assert.equal(out.customerRelationType,'Father');
  assert.equal(out.customerFatherName,'Current father');
  assert.equal(out.customerId,'CUSTOMER-12');
});
test('no relation snapshot and no matching customer leaves empty relation name',()=>{
  const input=data({saleRows:[{...sale,'Customer Relation Type':'','Customer Relation Name':''}],
    customerRows:[]});
  const out=runPair(input).value;
  assert.equal(out.customerFatherName,'');
});
test('no payment terms means no fabricated due-date and missing product falls back to empty unit',()=>{
  const input=data({settings:{...settings,'Invoice Payment Terms Days':0},productRows:[]});
  const out=runPair(input).value;
  assert.equal(out.dueDate,'');
  assert.equal(out.items[0].unit,'');
});
test('missing, duplicate or deleted invoice ID fails closed with source-compatible error',()=>{
  for(const saleRows of [[],[sale,sale],[{...sale,'Is Deleted':'TRUE'}]]){
    const output=runPair(data({saleRows}));
    assert.equal(output.ok,false);
  }
});
test('active payment child corruption fails closed without substituting ledger or legacy payments',()=>{
  const corrupt=[
    [{...bankPayment,'Applied Amount':55},cashPayment],
    [bankPayment,{...cashPayment,'Row Order':1}],
    [bankPayment,{...cashPayment,'Revision':2}],
    [bankPayment,{...cashPayment,'Change Amount':0}],
    [bankPayment,{...cashPayment,'Payment ID':'PAY-B'}]
  ];
  for(const paymentRows of corrupt){
    const output=runPair(data({paymentRows}));
    assert.equal(output.ok,false);
  }
});
test('projection does not mutate trusted source rows, settled amounts, or shop payload',()=>{
  const input=data(),native=createNativePostedInvoiceOracle(input),opts={...input,shop:native.shop()};
  const before=JSON.stringify(opts);
  projectPostedInvoice(invoiceId,opts);
  assert.equal(JSON.stringify(opts),before);
});
test('projection requires a trusted complete read context, not arbitrary client-supplied account state',()=>{
  assert.throws(()=>projectPostedInvoice(invoiceId,{}),/trusted/i);
  assert.throws(()=>projectPostedInvoice(invoiceId,{saleRows:[sale]}),/trusted/i);
});
