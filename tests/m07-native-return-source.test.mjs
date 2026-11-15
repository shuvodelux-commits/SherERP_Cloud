import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';

// Characterization tests execute the pinned, unmodified GAS business functions.
// Only the external Google Sheets/LockService perimeter is simulated; no D1
// correctness or migrated financial posting is claimed by this suite.
function original(file, overrides = {}) {
  const stats = {reads: 0, writes: 0, permission: [], cashSessionChecks: 0};
  const state = {
    CONFIG: {LOCK_TIMEOUT_MS: 1000},
    LockService: {getScriptLock() {
      return {waitLock() {}, releaseLock() {}};
    }},
    requirePermission_(token, module, action) {
      stats.permission.push([token, module, action]);
      return {'User ID': 'U-TEST'};
    },
    requireActiveCashSession_() {stats.cashSessionChecks++;},
    sanitizeInput_(value) {return String(value ?? '').trim();},
    safeDateOnly_(value) {return value || '';},
    isDeleted_(row) {return row.Status === 'Deleted';},
    isValidNonNegativeNumber_(value) {
      return value !== '' && value !== null &&
        value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0;
    },
    roundMoney_(value) {return Math.round((Number(value) + Number.EPSILON) * 100) / 100;},
    getAllRows_() {stats.reads++; throw new Error('Unexpected Sheets access');},
    appendRow_() {stats.writes++; throw new Error('Unexpected Sheets write');},
    updateRowFields_() {stats.writes++; throw new Error('Unexpected Sheets write');},
    fail_(message) {return {success: false, message};},
    logError_() {},
    ...overrides
  };
  const code = readFileSync(new URL('../legacy/source/' + file, import.meta.url), 'utf8');
  runInNewContext(code, state, {filename: file, timeout: 1000});
  return {state, stats};
}
const plain = value => JSON.parse(JSON.stringify(value));

test('Sales Return uses exact stored gross line economics rather than rounded unit-price multiplication', () => {
  const {state} = original('SalesReturn.gs');
  assert.equal(state.grossSaleItemLineTotal_({
    'Line Total': 10.01, Quantity: 3, 'Unit Price': 3.34
  }), 10.01);
  assert.equal(state.grossSaleItemLineTotal_({
    'Line Total': '', Quantity: 3, 'Unit Price': 3.34
  }), 10.02);
});

test('Sales Return request price defaults to effective sale price, accepts a discount, rejects excess and negatives', () => {
  const {state} = original('SalesReturn.gs');
  assert.equal(state.salesReturnRequestedUnitPrice_('', 12.345, 'Pipe'), 12.35);
  assert.equal(state.salesReturnRequestedUnitPrice_(9, 12.35, 'Pipe'), 9);
  assert.throws(() => state.salesReturnRequestedUnitPrice_(12.36, 12.35, 'Pipe'),
    /cannot exceed original sale price/);
  assert.throws(() => state.salesReturnRequestedUnitPrice_(-0.01, 12.35, 'Pipe'),
    /zero or greater/);
});

test('Purchase Return selects only original purchase lots in purchase-date and lot-ID FIFO order', () => {
  const {state,stats} = original('StockLots.gs');
  const lots = [
    {'Lot ID': 'LOT-000003', 'Purchase ID': 'PUR-A', 'Product ID': 'PIPE',
      'Purchase Date': '2026-01-02', 'Remaining Quantity': 2, 'Purchase Price': 25, _rowIndex: 8},
    {'Lot ID': 'LOT-000002', 'Purchase ID': 'PUR-A', 'Product ID': 'PIPE',
      'Purchase Date': '2026-01-01', 'Remaining Quantity': 1, 'Purchase Price': 20, _rowIndex: 7},
    {'Lot ID': 'LOT-000001', 'Purchase ID': 'PUR-A', 'Product ID': 'PIPE',
      'Purchase Date': '2026-01-01', 'Remaining Quantity': 2, 'Purchase Price': 18, _rowIndex: 6},
    {'Lot ID': 'LOT-000000', 'Purchase ID': 'PUR-B', 'Product ID': 'PIPE',
      'Purchase Date': '2025-01-01', 'Remaining Quantity': 50, 'Purchase Price': 10, _rowIndex: 5}
  ];
  const plan = state.planPurchaseReturnLotReduction_('PUR-A', 'PIPE', 4, lots);
  assert.equal(plan.legacyFallback, false);
  assert.deepEqual(plain(plan.draws.map(({lotId,take,unitCost}) => ({lotId,take,unitCost}))), [
    {lotId: 'LOT-000001', take: 2, unitCost: 18},
    {lotId: 'LOT-000002', take: 1, unitCost: 20},
    {lotId: 'LOT-000003', take: 1, unitCost: 25}
  ]);
  assert.equal(stats.writes, 0);
});

test('Purchase Return rejects insufficient original-lot balance instead of consuming another supplier purchase', () => {
  const {state,stats} = original('StockLots.gs');
  const lots = [
    {'Lot ID':'LOT-1','Purchase ID':'PUR-A','Product ID':'PIPE','Purchase Date':'2026-01-01',
      'Remaining Quantity':1,'Purchase Price':20,_rowIndex:5},
    {'Lot ID':'LOT-2','Purchase ID':'PUR-B','Product ID':'PIPE','Purchase Date':'2026-01-01',
      'Remaining Quantity':90,'Purchase Price':25,_rowIndex:6}
  ];
  assert.throws(() => state.planPurchaseReturnLotReduction_('PUR-A','PIPE',2,lots),
    /Lots for this purchase only have 1 remaining/);
  assert.equal(stats.writes, 0);
});

test('Sales Return deletion refuses missing child-line and original stock movement evidence', () => {
  const {state,stats} = original('StockLots.gs');
  const headers = [{'Return ID':'RET-1','Invoice ID':'INV-1'}];
  assert.throws(() => state.planSalesReturnStockUndo_('RET-1', {
    returnHeaders: headers, returnItems: [], movements: []
  }), /no active lines/i);
  assert.throws(() => state.planSalesReturnStockUndo_('RET-1', {
    returnHeaders: headers,
    returnItems: [{'Return ID':'RET-1','Product ID':'PIPE','Return Quantity':1}],
    movements: []
  }), /stock movement evidence missing/i);
  assert.equal(stats.writes, 0);
});

test('Sales Return batch fails before Sheets access when invoice count is outside 2–20', () => {
  const {state,stats} = original('SalesReturn.gs');
  for (const invoiceReturns of [[], [{invoiceId:'INV-1',items:[{productId:'PIPE',qty:1}]}],
    Array.from({length: 21}, (_,i) => ({invoiceId:'INV-'+i,items:[{productId:'PIPE',qty:1}]}))]) {
    const result = state.completeReturnBatch('TOKEN', {invoiceReturns, refundMethod:'Cash'});
    assert.equal(result.success, false);
    assert.match(result.message, /between 2 and 20 invoices/);
  }
  assert.equal(stats.reads,0);
  assert.equal(stats.writes,0);
  assert.equal(stats.cashSessionChecks,3);
  assert.deepEqual(stats.permission.map(v => plain(v)), [
    ['TOKEN','returns','add'],['TOKEN','returns','add'],['TOKEN','returns','add']
  ]);
});

test('Sales Return batch rejects duplicate invoices and excess product lines before any write', () => {
  const {state,stats} = original('SalesReturn.gs');
  const row = (invoiceId,count=1) => ({
    invoiceId, items:Array.from({length:count}, (_,i)=>({productId:'SKU-'+i,qty:1}))
  });
  const duplicate = state.completeReturnBatch('TOKEN', {
    invoiceReturns:[row('INV-1'),row('INV-1')], refundMethod:'Store Credit'
  });
  assert.equal(duplicate.success,false);
  assert.match(duplicate.message,/Duplicate invoice in batch/);
  const excess = state.completeReturnBatch('TOKEN', {
    invoiceReturns:[row('INV-1',51),row('INV-2',50)], refundMethod:'Cash'
  });
  assert.equal(excess.success,false);
  assert.match(excess.message,/at most 100 product lines/);
  assert.equal(stats.reads,0);
  assert.equal(stats.writes,0);
});

test('Purchase Return requires purchase authority and Cash Session before any return writes', () => {
  const {state,stats} = original('PurchaseReturn.gs');
  const invalid = state.completePurchaseReturn('TOKEN', {
    purchaseId: 'PUR-1', items: [{productId:'PIPE',qty:1}],
    refundMethod: 'Bank Transfer'
  });
  assert.equal(invalid.success, false);
  assert.match(invalid.message, /Choose a refund method/);
  assert.deepEqual(stats.permission.map(v => plain(v)), [['TOKEN','purchase','add']]);
  assert.equal(stats.cashSessionChecks, 1);
  assert.equal(stats.reads, 0);
  assert.equal(stats.writes, 0);
});
