import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSalePayments_} from '../src/modules/sale-payments.js';
import {auditMixedUnitSaleCheckoutSnapshot} from '../src/modules/m06-sale-checkout-snapshot-audit.js';

const accounts=[
  {'Bank Account ID':'BANK-1','Account Name':'Bank One','Account Type':'Bank',Status:'Active'},
  {'Bank Account ID':'MOB-1','Account Name':'Mobile One','Account Type':'Mobile Banking',Status:'Active'}
];
const cash=(id,amount)=>({id,method:'Cash',amount});
const bank=(id,amount)=>({id,method:'Bank',accountId:'BANK-1',amount});
const mobile=(id,amount)=>({id,method:'Mobile Banking',accountId:'MOB-1',amount});
const clone=x=>structuredClone(x);
const audit=auditMixedUnitSaleCheckoutSnapshot;
const codes=r=>r.issues.map(x=>x.code);

function historical(paymentRows,discount=0){
  const subtotal=1340,grandTotal=Math.max(0,subtotal-discount);
  return {
    lines:[{
      productId:'P-FIXTURE',stockUnit:'Pcs',baseQty:145,
      unitPrice:9.24,lineTotal:1340,shortageMode:'Own',
      unitBreakdownSnapshot:[
        {conversionId:'BAG',unitName:'Bag',factor:100,qty:1},
        {conversionId:'BOX',unitName:'Box',factor:20,qty:2},
        {conversionId:'BASE',unitName:'Pcs',factor:1,qty:5}
      ],
      unitPricingSnapshot:[
        {conversionId:'BAG',unitName:'Bag',factor:100,qty:1,unitPrice:900},
        {conversionId:'BOX',unitName:'Box',factor:20,qty:2,unitPrice:190},
        {conversionId:'BASE',unitName:'Pcs',factor:1,qty:5,unitPrice:12}
      ],
      fifoDraws:[{lotId:'LOT-A',baseQty:100},{lotId:'LOT-B',baseQty:45}],
      shortfallBaseQty:0
    }],
    subtotal,discount,grandTotal,
    allocation:normalizeSalePayments_(grandTotal,paymentRows,accounts)
  };
}
function expectReady(candidate){
  const before=clone(candidate),result=audit(candidate);
  assert.equal(result.ready,true,JSON.stringify(result));
  assert.deepEqual(result.issues,[]);
  assert.deepEqual(candidate,before,'Readback must not mutate original invoice or payment evidence');
  return result;
}
function expectCode(candidate,code){
  const before=clone(candidate),result=audit(candidate);
  assert.equal(result.ready,false,JSON.stringify(result));
  assert.ok(codes(result).includes(code),JSON.stringify(result));
  assert.deepEqual(candidate,before,'Readback must not rewrite historical evidence');
}

test('unchanged source-normalized split cash/bank/mobile payment header and historical unit snapshots remain valid',()=>{
  const saved=historical([bank('B',500),mobile('M',285),cash('C',650)]);
  assert.equal(saved.allocation.paymentType,'Cash');
  assert.equal(saved.allocation.paymentMethod,'Multiple');
  assert.equal(saved.allocation.changeAmount,95);
  assert.equal(saved.lines[0].baseQty*saved.lines[0].unitPrice,1339.8);
  assert.equal(saved.lines[0].lineTotal,1340);
  expectReady(saved);
});

test('the exact original source supports Cash-only Paid, Bank-only Paid and Mobile Partial headers',()=>{
  const fullCash=historical([cash('C',1400)]);
  assert.deepEqual([fullCash.allocation.paymentType,fullCash.allocation.paymentMethod,
    fullCash.allocation.bankAccountId,fullCash.allocation.changeAmount],['Cash','Cash','',60]);
  expectReady(fullCash);
  const fullBank=historical([bank('B',1340)]);
  assert.deepEqual([fullBank.allocation.paymentType,fullBank.allocation.paymentMethod,
    fullBank.allocation.bankAccountId,fullBank.allocation.bankAccountName],
  ['Cash','Bank','BANK-1','Bank One']);
  expectReady(fullBank);
  const partial=historical([mobile('M',200)]);
  assert.deepEqual([partial.allocation.paymentType,partial.allocation.paymentStatus,
    partial.allocation.paymentMethod,partial.allocation.dueAmount],
    ['Partial','Partial','Mobile Banking',1140]);
  expectReady(partial);
});

test('all-Due and discounted zero-grand source headers are valid despite counterintuitive Payment Type',()=>{
  const entirelyDue=historical([]);
  assert.equal(entirelyDue.allocation.paymentType,'Due');
  assert.equal(entirelyDue.allocation.paymentMethod,'');
  expectReady(entirelyDue);
  const zeroGrand=historical([],1340);
  assert.deepEqual([zeroGrand.allocation.paymentStatus,zeroGrand.allocation.paymentType,
    zeroGrand.allocation.paymentMethod],['Paid','Cash','']);
  expectReady(zeroGrand);
});

test('legitimate Cash fully returned as change with 0 applied and Bank-covered invoice is retained',()=>{
  const value=historical([bank('B',1340),cash('C',20)]);
  assert.deepEqual(value.allocation.payments.map(x=>x.applied),[1340,0]);
  assert.deepEqual(value.allocation.payments.map(x=>x.change),[0,20]);
  assert.equal(value.allocation.paymentMethod,'Bank');
  expectReady(value);
});

test('original source rowOrder gaps are legal when zero-value input rows were removed',()=>{
  const value=historical([cash('ignored',0),bank('B',1340)]);
  assert.deepEqual(value.allocation.payments.map(x=>x.rowOrder),[2]);
  expectReady(value);
});

test('forged Payment Type and Payment Status cannot pass even when Paid+Due balances',()=>{
  const a=historical([bank('B',1340)]);a.allocation.paymentType='Due';
  expectCode(a,'PAYMENT_TYPE_MISMATCH');
  const b=historical([mobile('M',200)]);b.allocation.paymentType='Cash';
  expectCode(b,'PAYMENT_TYPE_MISMATCH');
  const c=historical([mobile('M',200)]);c.allocation.paymentStatus='Paid';
  expectCode(c,'PAYMENT_STATUS_MISMATCH');
});

test('forged payment method and positive split tender attribution cannot be reclassified',()=>{
  const a=historical([bank('B',500),mobile('M',840)]);
  a.allocation.paymentMethod='Bank';
  expectCode(a,'PAYMENT_METHOD_MISMATCH');
  const b=historical([bank('B',1340)]);
  b.allocation.paymentMethod='Cash';
  expectCode(b,'PAYMENT_METHOD_MISMATCH');
  const c=historical([]);c.allocation.paymentMethod='Cash';
  expectCode(c,'PAYMENT_METHOD_MISMATCH');
});

test('single active Bank/Mobile payment must preserve its original account ID/name header',()=>{
  const a=historical([bank('B',1340)]);a.allocation.bankAccountId='MOB-1';
  expectCode(a,'PAYMENT_HEADER_ACCOUNT_MISMATCH');
  const b=historical([mobile('M',100)]);b.allocation.bankAccountName='changed';
  expectCode(b,'PAYMENT_HEADER_ACCOUNT_MISMATCH');
  const c=historical([cash('C',1340)]);c.allocation.bankAccountId='BANK-1';
  expectCode(c,'PAYMENT_HEADER_ACCOUNT_MISMATCH');
  const d=historical([bank('B',500),mobile('M',840)]);d.allocation.bankAccountId='BANK-1';
  expectCode(d,'PAYMENT_HEADER_ACCOUNT_MISMATCH');
});

test('original payment Row Order must be safe, positive, unique, and <= 20, but not contiguous',()=>{
  for(const bad of [0,-1,1.5,21,NaN,'1']){
    const x=historical([bank('B',500),mobile('M',840)]);
    x.allocation.payments[0].rowOrder=bad;
    expectCode(x,'INVALID_PAYMENT_ROW_ORDER');
  }
  const dup=historical([bank('B',500),mobile('M',840)]);
  dup.allocation.payments[1].rowOrder=dup.allocation.payments[0].rowOrder;
  expectCode(dup,'DUPLICATE_PAYMENT_ROW_ORDER');
});

test('phantom noncash zero-applied and zero-tender Cash child rows are not source allocations',()=>{
  const noncash=historical([bank('B',1340)]);
  noncash.allocation.payments.push({...noncash.allocation.payments[0],
    rowId:'PHANTOM',rowOrder:2,applied:0,tendered:0,change:0});
  expectCode(noncash,'UNEXPECTED_ZERO_PAYMENT_ROW');
  const ghost=historical([bank('B',1340)]);
  ghost.allocation.payments.push({rowId:'GHOST',rowOrder:2,method:'Cash',
    bankAccountId:'',bankAccountName:'',applied:0,tendered:0,change:0});
  expectCode(ghost,'UNEXPECTED_ZERO_PAYMENT_ROW');
});

test('zero-applied Cash with equal positive tender and change remains source-valid',()=>{
  const value=historical([bank('B',1340),cash('C',20)]);
  expectReady(value);
  value.allocation.payments[1].tendered=0;
  expectCode(value,'CASH_TENDER_MISMATCH');
});

test('mixed-unit historical line must retain its canonical nonempty stock unit',()=>{
  const bad=historical([bank('B',1340)]);
  bad.lines[0].stockUnit='';
  expectCode(bad,'INVALID_STOCK_UNIT');
  const missing=historical([cash('C',1340)]);
  delete missing.lines[0].stockUnit;
  expectCode(missing,'INVALID_STOCK_UNIT');
});
