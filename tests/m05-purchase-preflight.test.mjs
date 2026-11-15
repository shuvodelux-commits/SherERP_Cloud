import test from 'node:test';
import assert from 'node:assert/strict';
import { preparePurchasePreflight } from '../src/modules/purchase-preflight.js';

const suppliers = [
  { 'Supplier ID': 'SUP-001', 'Supplier Name': 'One Supplier', Status: 'Active', 'Current Due': 500 },
  { 'Supplier ID': 'SUP-002', 'Supplier Name': 'Closed Supplier', Status: 'Inactive' },
  { 'Supplier ID': 'SUP-003', 'Supplier Name': 'Removed Supplier', Status: 'Active', 'Is Deleted': 'TRUE' }
];
const products = [
  { 'Product ID': 'P-01', 'Product Name': 'Cable', 'Current Stock': 2, 'Product Type': 'Standard', _rowIndex: 8 },
  { 'Product ID': 'P-02', 'Product Name': 'Switch', 'Current Stock': -3, 'Product Type': 'Standard', _rowIndex: 9 },
  { 'Product ID': 'P-03', 'Product Name': 'Bundle', 'Current Stock': 0, 'Product Type': 'Bundle', _rowIndex: 10 },
  { 'Product ID': 'P-04', 'Product Name': 'Deleted', 'Current Stock': 5, 'Is Deleted': 'TRUE', _rowIndex: 11 }
];
const line = (productId = 'P-01', qty = 2, unitPrice = 12.5, sellingPrice = 18) =>
  ({ productId, name: productId, qty, unitPrice, sellingPrice });
const input = (items = [line()], extra = {}) => ({ supplierId: 'SUP-001', items, discount: 0, paidAmount: 0, ...extra });
const plan = (payload) => preparePurchasePreflight(payload, { products, suppliers });

test('source-shaped mixed-product purchase preflight preserves lot pricing and stock snapshots', () => {
  const value = plan(input([line('P-01', 3, 10, 14), line('P-02', 2, 8, 12)], { discount: 4, paidAmount: 12 }));
  assert.deepEqual(value, {
    supplierId: 'SUP-001', supplierName: 'One Supplier',
    lines: [
      { productId: 'P-01', name: 'P-01', qty: 3, price: 10, sellPrice: 14, rowIndex: 8, currentStock: 2, newStock: 5 },
      { productId: 'P-02', name: 'P-02', qty: 2, price: 8, sellPrice: 12, rowIndex: 9, currentStock: -3, newStock: -1 }
    ],
    subtotal: 46, discount: 4, grandTotal: 42, paidAmount: 12, dueAmount: 30, paymentStatus: 'Partial'
  });
});

test('no payment is Due; overpayment clamps to grand total; negative discount and NaN payment default zero', () => {
  const due = plan(input());
  assert.equal(due.paymentStatus, 'Due');
  assert.equal(due.dueAmount, 25);
  const paid = plan(input([line()], { discount: 5, paidAmount: 999 }));
  assert.equal(paid.grandTotal, 20);
  assert.equal(paid.paidAmount, 20);
  assert.equal(paid.paymentStatus, 'Paid');
  const fallback = plan(input([line()], { discount: -99, paidAmount: 'invalid' }));
  assert.equal(fallback.discount, 0);
  assert.equal(fallback.paidAmount, 0);
});

test('missing, inactive, and soft-deleted suppliers cannot produce a plan', () => {
  assert.throws(() => plan(input([], { supplierId: '' })), /Choose a supplier/);
  assert.throws(() => plan(input([], { supplierId: 'SUP-001' })), /Add at least one product line/);
  for (const id of ['SUP-002', 'SUP-003', 'unknown']) {
    assert.throws(() => plan(input([line()], { supplierId: id })), /Supplier not found or inactive/);
  }
});

test('quantity, cost, and lot selling price are checked before a write', () => {
  for (const qty of [0, -1, 'bad', Infinity]) {
    assert.throws(() => plan(input([line('P-01', qty)])), /Line 1: quantity must be greater than zero/);
  }
  for (const price of [-1, NaN, Infinity]) {
    assert.throws(() => plan(input([line('P-01', 1, price)])), /Line 1: unit price must be a valid number/);
    assert.throws(() => plan(input([line('P-01', 1, 10, price)])), /Line 1: sell price must be a valid number/);
  }
});

test('duplicate product, missing/deleted product, and physical bundle rules mirror createPurchase preflight', () => {
  assert.throws(() => plan(input([line(), line()])), /appears more than once/);
  assert.throws(() => plan(input([line('P-404')])), /no longer exists/);
  assert.throws(() => plan(input([line('P-04')])), /no longer exists/);
  assert.throws(() => plan(input([line('P-03')])), /Virtual bundle sets cannot be purchased as physical stock/);
});

test('input snapshots are never mutated and the result contains no ledger, cash or posting instruction', () => {
  const payload = input([line()], { date: '2026-10-10', backdatedReason: 'Test' });
  const pBefore = structuredClone(payload);
  const productsBefore = structuredClone(products);
  const suppliersBefore = structuredClone(suppliers);
  const result = plan(payload);
  assert.deepEqual(payload, pBefore);
  assert.deepEqual(products, productsBefore);
  assert.deepEqual(suppliers, suppliersBefore);
  assert.equal('statements' in result, false);
  assert.equal('journal' in result, false);
  assert.equal('operationId' in result, false);
});
