import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLotPricingLadder_, planStockConsumption_, planSaleVendorConsumption_
} from '../src/modules/stock-fifo-planning.js';
import { planConsistentStockPreview } from '../src/modules/m05-fifo-eligibility-gate.js';

const product = (extra = {}) => ({
  'Product ID': 'PRD-001',
  'Product Name': 'Cable',
  'Purchase Price': 5,
  'Selling Price': 12,
  'Current Stock': 5,
  ...extra
});
const lot = (id, date, quantity, extra = {}) => ({
  'Lot ID': id,
  'Product ID': 'PRD-001',
  'Purchase Date': date,
  'Remaining Quantity': quantity,
  'Purchase Price': 5,
  'Sell Price': 12,
  'Supplier ID': 'SUP-A',
  'Status': 'Active',
  _rowIndex: Number(id.slice(-2)) + 2,
  ...extra
});
const preview = (allLots, options = {}) => planConsistentStockPreview({
  productId: 'PRD-001',
  quantity: 3,
  allLots,
  productRow: product(),
  ...options
});

test('RED safety contract: source consumption can count deleted stock excluded from price ladder', () => {
  const deleted = lot('LOT-01', '2026-11-01', 4, {Status:'Deleted'});
  assert.equal(planStockConsumption_('PRD-001', 1, [deleted], product()).draws.length, 1);
  assert.deepEqual(buildLotPricingLadder_('PRD-001', [deleted], product()).segments, []);
  assert.throws(() => preview([deleted]), /deleted positive-stock lot/i);
});

test('valid multi-supplier source FIFO and pricing stay unchanged and input snapshots are immutable', () => {
  const allLots = [
    lot('LOT-03', '2026-11-12', 2, { 'Supplier ID': 'SUP-A', 'Sell Price': 15 }),
    lot('LOT-02', '2026-11-11', 1, { 'Supplier ID': 'SUP-B', 'Sell Price': 11 }),
    lot('LOT-01', '2026-11-11', 2, { 'Supplier ID': 'SUP-C', 'Sell Price': 11 }),
    lot('LOT-04', '2026-11-08', -2, { 'Status': 'Oversold', 'Supplier ID': 'SUP-D' })
  ];
  const before = structuredClone(allLots);
  const sourceProduct = product();
  const beforeProduct = structuredClone(sourceProduct);
  const actual = preview(allLots, {productRow: sourceProduct});
  assert.deepEqual(actual, {
    consumption: planStockConsumption_('PRD-001', 3, allLots, sourceProduct),
    pricing: buildLotPricingLadder_('PRD-001', allLots, sourceProduct)
  });
  assert.deepEqual(actual.consumption.draws.map(d => d.lotId), ['LOT-01', 'LOT-02']);
  assert.deepEqual(allLots, before);
  assert.deepEqual(sourceProduct, beforeProduct);
  assert.equal('journal' in actual, false);
  assert.equal('statements' in actual, false);
});

test('deleted zero-remaining lots and deleted lots of another product do not block planning', () => {
  const allLots = [
    lot('LOT-01', '2026-11-01', 0, { Status: 'Deleted' }),
    lot('LOT-02', '2026-11-02', 100, { 'Product ID': 'OTHER', Status: 'Deleted' }),
    lot('LOT-03', '2026-11-03', 2)
  ];
  const result = preview(allLots);
  assert.deepEqual(result.consumption.draws.map(d => d.lotId), ['LOT-03']);
  assert.equal(result.consumption.shortfall, 1);
  assert.deepEqual(result.pricing.segments, [{qty: 2, sellPrice: 12}]);
});

test('vendor-sourced preview respects net Current Stock despite positive lot inventory', () => {
  const allLots = [lot('LOT-01', '2026-11-01', 5)];
  const p = product({'Current Stock': 1});
  const result = preview(allLots, {productRow: p, quantity: 4, vendorSourced: true});
  assert.deepEqual(result.consumption,
    planSaleVendorConsumption_('PRD-001', 4, allLots, p));
  assert.equal(result.consumption.draws[0].take, 1);
  assert.equal(result.consumption.shortfall, 3);
  assert.deepEqual(result.pricing,
    buildLotPricingLadder_('PRD-001', allLots, p));
});

test('invalid quantities, snapshots and product mismatch fail closed', () => {
  const allLots = [lot('LOT-01', '2026-11-01', 5)];
  for (const quantity of [-1, Infinity, NaN, 'unknown', null, '']) {
    assert.throws(() => preview(allLots, {quantity}), /quantity/i);
  }
  assert.throws(() => preview(undefined), /lot snapshot/i);
  assert.throws(() => preview(null), /lot snapshot/i);
  assert.throws(() => preview(allLots, {productRow: undefined}), /product snapshot/i);
  assert.throws(() => preview(allLots, {productRow: product({'Product ID':'OTHER'})}), /product.*mismatch/i);
  assert.throws(() => preview(allLots, {productId: ''}), /product id/i);
  assert.throws(() => preview(allLots, {vendorSourced: 'yes'}), /vendorSourced/i);
});

test('zero quantity is a safe read-only preview; deleted lot with positive remaining still blocks', () => {
  const allLots = [lot('LOT-01', '2026-11-01', 2)];
  const result = preview(allLots, {quantity: 0});
  assert.deepEqual(result.consumption.draws, []);
  assert.equal(result.consumption.shortfall, 0);
  assert.throws(() => preview([lot('LOT-01','2026-11-01', 2, {Status:'Deleted'})], {quantity: 0}),
    /deleted positive-stock lot/i);
});
