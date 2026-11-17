import test from 'node:test';
import assert from 'node:assert/strict';
import {planMultiUnitPosCheckoutPreview} from '../src/modules/m06-mixed-unit-pos-checkout-preview.js';

// Test-first: the auditor is intentionally absent on this RED commit.
const audit=await import('../src/modules/m06-sale-checkout-snapshot-audit.js')
  .then(mod=>mod.auditMixedUnitSaleCheckoutSnapshot)
  .catch(error=>{
    if(error?.code==='ERR_MODULE_NOT_FOUND')return undefined;
    throw error;
  });
const review=value=>{
  assert.equal(typeof audit,'function','M06 historical checkout snapshot auditor is missing');
  return audit(value);
};
const clone=value=>structuredClone(value);
const account=(id,type)=>({
  'Bank Account ID':id,'Account Name':type+' '+id,'Account Type':type,
  Status:'Active','Is Deleted':'FALSE'
});
function source(){
  return {
    products:[
      {'Product ID':'M','Product Name':'Fastener','Product Type':'Standard',
        Unit:'Pcs','Selling Price':10,'Purchase Price':6,'Current Stock':145,Status:'Active'},
      {'Product ID':'P','Product Name':'Pipe','Product Type':'Standard',
        Unit:'Feet','Selling Price':30,'Current Stock':2,Status:'Active'}
    ],
    conversionRows:[
      {'Conversion ID':'BAG','Product ID':'M','Unit Name':'Bag','Conversion Factor':100,
        'Selling Price':900,Status:'Active'},
      {'Conversion ID':'BOX','Product ID':'M','Unit Name':'Box','Conversion Factor':20,
        'Selling Price':190,Status:'Active'}
    ],
    stockLots:[
      {'Lot ID':'LO-1','Product ID':'M','Purchase Date':'2026-11-10','Remaining Quantity':100,
        'Sell Price':10,'Purchase Price':6,Status:'Active'},
      {'Lot ID':'LO-2','Product ID':'M','Purchase Date':'2026-11-11','Remaining Quantity':45,
        'Sell Price':12,'Purchase Price':6,Status:'Active'},
      {'Lot ID':'LO-P','Product ID':'P','Purchase Date':'2026-11-11','Remaining Quantity':2,
        'Sell Price':30,'Purchase Price':17,Status:'Active'}
    ],
    bankAccounts:[account('B1','Bank'),account('W1','Mobile Banking')]
  };
}
function payload(){
  return {
    lines:[
      {productId:'M',claimedBaseQty:145,shortageMode:'Own',
        unitBreakdown:[{conversionId:'BAG',qty:1},{conversionId:'BOX',qty:2},{conversionId:'BASE',qty:5}]},
      {productId:'P',claimedBaseQty:2,shortageMode:'Own',unitBreakdown:[]}
    ],
    discount:15,
    payments:[
      {id:'BANK',method:'Bank',accountId:'B1',amount:500},
      {id:'WALLET',method:'Mobile Banking',accountId:'W1',amount:285},
      {id:'CASH',method:'Cash',amount:650}
    ]
  };
}
const original=()=>planMultiUnitPosCheckoutPreview(payload(),source());
function codes(result){return result.issues.map(i=>i.code)}
const assertProblem=(change,code)=>{
  const candidate=original(),before=clone(candidate);
  change(candidate);
  const invalidSnapshot=clone(candidate);
  const result=review(candidate);
  assert.equal(result.ready,false,JSON.stringify(result));
  assert.ok(codes(result).includes(code),JSON.stringify(result));
  assert.deepEqual(candidate,invalidSnapshot,'Audit may not mutate corrupted source');
  assert.notDeepEqual(candidate,before,'Regression fixture must truly corrupt source');
  return result;
};

test('actual mixed-unit checkout remains auditable despite rounded base unit price',()=>{
  const data=original(),before=clone(data),out=review(data);
  assert.equal(data.lines[0].unitPrice,9.24);
  assert.notEqual(data.lines[0].baseQty*data.lines[0].unitPrice,data.lines[0].lineTotal);
  assert.deepEqual(out.issues,[]);
  assert.equal(out.ready,true);
  assert.equal(out.summary.lines,2);
  assert.equal(out.summary.unitLines,1);
  assert.equal(out.summary.legacyLines,1);
  assert.equal(out.summary.subtotal,1400);
  assert.equal(out.summary.grandTotal,1385);
  assert.equal(out.summary.paidAmount,1385);
  assert.equal(out.summary.dueAmount,0);
  assert.equal(out.summary.cashChange,50);
  assert.deepEqual(data,before,'Auditor is pure and never repairs input');
});

test('valid historical unit snapshots are reviewed alone, independent of changed present-day catalog',()=>{
  const data=original(),current=source();
  current.products[0]['Selling Price']=1;
  current.products[0]['Current Stock']=0;
  current.conversionRows[0]['Conversion Factor']=200;
  current.conversionRows[0]['Selling Price']=123;
  assert.equal(review(data).ready,true,
    'Existing immutable checkout is not repriced with current Product/Conversion records');
});

test('source item historical factor, quantity and pricing identity corruption are independent findings',()=>{
  assertProblem(x=>{x.lines[0].unitBreakdownSnapshot[0].factor=99;},
    'BASE_QUANTITY_MISMATCH');
  assertProblem(x=>{x.lines[0].unitPricingSnapshot[0].factor=99;},
    'COMPONENT_IDENTITY_MISMATCH');
  assertProblem(x=>{x.lines[0].unitBreakdownSnapshot[1].conversionId='BAG';},
    'DUPLICATE_CONVERSION_ID');
  assertProblem(x=>{x.lines[0].unitPricingSnapshot[0].unitPrice=800;},
    'COMPONENT_PRICE_TOTAL_MISMATCH');
  assertProblem(x=>{x.lines[0].unitPricingSnapshot[0].unitPrice=-1;},
    'INVALID_COMPONENT_PRICE');
});

test('physical FIFO and explicit shortage must conserve the original base stock quantity',()=>{
  assertProblem(x=>{x.lines[0].fifoDraws[1].baseQty=44;},
    'FIFO_COVERAGE_MISMATCH');
  assertProblem(x=>{x.lines[0].fifoDraws[1].lotId='LO-1';},
    'DUPLICATE_FIFO_LOT');
  assertProblem(x=>{x.lines[0].shortfallBaseQty=1;},
    'OWN_MODE_SHORTFALL');
  assertProblem(x=>{x.lines[0].baseQty=144;},
    'BASE_QUANTITY_MISMATCH');
});

test('a legitimate historical Vendor or Negative shortage stays reviewable without current stock data',()=>{
  const s=source();s.products[0]['Current Stock']=140;
  const i=payload();i.lines[0].shortageMode='Vendor';
  const vendor=planMultiUnitPosCheckoutPreview(i,s);
  assert.equal(vendor.lines[0].shortfallBaseQty,5);
  assert.equal(review(vendor).ready,true);
  i.lines[0].shortageMode='Negative';
  const negative=planMultiUnitPosCheckoutPreview(i,s);
  assert.equal(review(negative).ready,true);
});

test('one historical legacy line has two empty unit arrays and cannot gain a fabricated half-snapshot',()=>{
  assert.equal(review(original()).ready,true);
  assertProblem(x=>{x.lines[1].unitPricingSnapshot.push({
    conversionId:'BASE',unitName:'Feet',factor:1,qty:2,unitPrice:30
  });},'INCOMPLETE_UNIT_SNAPSHOT');
});

test('saved integer-paisa checkout header must exactly reconcile source-derived line totals',()=>{
  assertProblem(x=>{x.subtotal=1399.99;},'SUBTOTAL_MISMATCH');
  assertProblem(x=>{x.discount=15.01;},'GRAND_TOTAL_MISMATCH');
  assertProblem(x=>{x.grandTotal=1384.99;},'GRAND_TOTAL_MISMATCH');
  assertProblem(x=>{x.lines[0].lineTotal=1340.01;},'SUBTOTAL_MISMATCH');
});

test('split payment applied totals and original checkout Paid+Due must conserve Grand Total',()=>{
  assertProblem(x=>{x.allocation.paidAmount=1384;},'PAID_DUE_MISMATCH');
  assertProblem(x=>{x.allocation.payments[0].applied=499;},'APPLIED_TOTAL_MISMATCH');
  assertProblem(x=>{x.allocation.payments[0].rowId='CASH';},'DUPLICATE_PAYMENT_ROW_ID');
});

test('Cash change is receipt metadata, not extra cash income',()=>{
  assertProblem(x=>{x.allocation.payments[2].change=49;},'CASH_TENDER_MISMATCH');
  assertProblem(x=>{x.allocation.changeAmount=49;},'CASH_CHANGE_MISMATCH');
  assertProblem(x=>{x.allocation.payments[0].change=1;},'NONCASH_CHANGE');
});

test('invalid trusted shapes, inherited exotic objects and accessors are refused without invoking them',()=>{
  assert.throws(()=>review(null),/trusted|snapshot/i);
  const data=original();delete data.lines;
  assert.throws(()=>review(data),/trusted|line|snapshot/i);
  const other=original();
  Object.defineProperty(other.lines[0].unitBreakdownSnapshot[0],'factor',{
    enumerable:true,get:()=>{throw new Error('UNSAFE_GETTER_CALLED');}
  });
  assert.throws(()=>review(other),/trusted|accessor|invalid/i);
});
