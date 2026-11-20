/**
 * M03 Run 3 precision policy review — execute arithmetic lifted from frozen
 * Purchase.gs/PurchaseReturn.gs. Not a schema policy or a financial D1 writer.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  sourcePurchaseAmounts,sourceSupplierReturnAmounts
} from '../fixtures/m03-run3-purchase-arithmetic.mjs';

test('oversize purchase discount is retained in source but does not create negative payable or cash',()=>{
  const result=sourcePurchaseAmounts({
    subtotal:60,discount:70,paidAmount:25,paymentMethod:'Cash'
  });
  assert.deepEqual(result,{
    discount:70,grandTotal:0,paidAmount:0,dueAmount:0,
    paymentStatus:'Paid',paymentMethod:''
  });
});

test('immediate paid amount is capped; nonpaid bank selection produces blank method',()=>{
  const paid=sourcePurchaseAmounts({
    subtotal:60,discount:0,paidAmount:70,paymentMethod:'Bank'
  });
  assert.equal(paid.paidAmount,60);
  assert.equal(paid.grandTotal,60);
  assert.equal(paid.dueAmount,0);
  assert.equal(paid.paymentMethod,'Bank');
  const unpaid=sourcePurchaseAmounts({
    subtotal:60,discount:0,paidAmount:0,paymentMethod:'Bank'
  });
  assert.equal(unpaid.dueAmount,60);
  assert.equal(unpaid.paymentMethod,'');
  assert.equal(unpaid.paymentStatus,'Due');
});

test('source purchase arithmetic retains a supplied fractional sub-paisa subtotal',()=>{
  const subtotal=0.5*10.005;
  const result=sourcePurchaseAmounts({
    subtotal,discount:0,paidAmount:0,paymentMethod:''
  });
  assert.equal(result.grandTotal,5.0025);
  assert.equal(result.dueAmount,5.0025);
  assert.equal(result.paidAmount,0);
});

test('per-return rounding differs from a single full return: do not select policy implicitly',()=>{
  const one=sourceSupplierReturnAmounts({
    qty:1,boughtQty:3,grossValue:3,purchaseSubtotal:3,purchaseGrandTotal:1
  });
  const whole=sourceSupplierReturnAmounts({
    qty:3,boughtQty:3,grossValue:3,purchaseSubtotal:3,purchaseGrandTotal:1
  });
  assert.equal(one.lineTotal,0.33);
  assert.equal(whole.lineTotal,1);
  assert.equal(one.lineTotal*3,0.99);
  assert.equal(Math.round((whole.lineTotal-one.lineTotal*3)*100),1);
  assert.equal(one.storedUnitPrice,0.33);
  assert.equal(whole.storedUnitPrice,1/3);
});

test('return effective price uses discounted invoice amount, not original gross unit cost',()=>{
  const res=sourceSupplierReturnAmounts({
    qty:2,boughtQty:10,grossValue:600,purchaseSubtotal:600,purchaseGrandTotal:540
  });
  assert.equal(res.lineTotal,108);
  assert.equal(res.storedUnitPrice,54);
});
