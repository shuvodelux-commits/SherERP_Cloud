/**
 * M05 source stock-lot reconciliation: internal READ-ONLY import audit.
 *
 * Frozen Mohim_ERP StockLots.gs::reconcileProductStocksFromLots_ adds every
 * Remaining Quantity for a Product ID, including Deleted and OVERSOLD lots.
 * Unlike that GAS repair routine, this helper never updates Current Stock.
 *
 * A ready report is review evidence only, not authority to deploy/import,
 * consume lots, override stock, or post financial transactions to D1.
 */
function plain(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const proto = Object.getPrototypeOf(row);
  return (proto === Object.prototype || proto === null) &&
    Object.values(Object.getOwnPropertyDescriptors(row))
      .every(d => Object.hasOwn(d, 'value'));
}

function rows(snapshot, key) {
  if (!Array.isArray(snapshot[key])) {
    throw new TypeError('Explicit trusted ' + key + ' snapshot array required.');
  }
  for (const row of snapshot[key]) {
    if (!plain(row)) throw new TypeError('Invalid ' + key + ' row or accessor.');
  }
  return snapshot[key];
}

function identifier(value) {
  if (typeof value === 'string') return value.trim() ? value : '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

// A blank legacy sheet cell behaves as zero in the frozen GAS source.
// Garbage, nonfinite values, booleans and objects cannot prove import parity.
function quantity(value) {
  if (value === '' || value === null || value === undefined) return 0;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

export function auditSourceStockLotBalances(snapshot) {
  if (!plain(snapshot)) throw new TypeError('Trusted stock-lot snapshot required.');
  const products = rows(snapshot, 'products');
  const lots = rows(snapshot, 'stockLots');
  const issues = [];
  const productIds = new Set(), duplicateProducts = new Set();
  const lotIds = new Set(), totalByProduct = new Map(), countByProduct = new Map();
  const invalidLotQuantityProducts = new Set();
  let orphanLots = 0, oversoldLots = 0, deletedPositiveLots = 0;
  let mismatchedProducts = 0, missingLotsNonzeroProducts = 0;
  const addIssue = (code, details = {}) => issues.push({code, ...details});

  for (const [index, product] of products.entries()) {
    const id = identifier(product['Product ID']);
    if (!id) {
      addIssue('MISSING_PRODUCT_ID', {row: index});
    } else if (productIds.has(id)) {
      duplicateProducts.add(id);
      addIssue('DUPLICATE_PRODUCT_ID', {productId: id, row: index});
    }
    if (id) productIds.add(id);
    if (quantity(product['Current Stock']) === null) {
      addIssue('INVALID_CURRENT_STOCK', {productId: id, row: index});
    }
  }

  for (const [index, lot] of lots.entries()) {
    const id = identifier(lot['Lot ID']);
    const productId = identifier(lot['Product ID']);
    const qty = quantity(lot['Remaining Quantity']);
    if (!id) addIssue('MISSING_LOT_ID', {productId, row: index});
    else if (lotIds.has(id)) {
      addIssue('DUPLICATE_LOT_ID', {productId, lotId: id, row: index});
    }
    if (id) lotIds.add(id);
    if (!productId) {
      addIssue('MISSING_LOT_PRODUCT_ID', {lotId: id, row: index});
    } else if (!productIds.has(productId)) {
      orphanLots++;
      addIssue('ORPHAN_LOT', {productId, lotId: id, row: index});
    }
    if (qty === null) {
      addIssue('INVALID_LOT_QUANTITY', {productId, lotId: id, row: index});
      if (productId) invalidLotQuantityProducts.add(productId);
    }
    if (!productId) continue;
    countByProduct.set(productId, (countByProduct.get(productId) || 0) + 1);
    if (qty === null) continue;

    // Keep exact GAS Number addition order, without rounding or filtering.
    const total = (totalByProduct.get(productId) || 0) + qty;
    if (!Number.isFinite(total)) {
      invalidLotQuantityProducts.add(productId);
      addIssue('INVALID_LOT_QUANTITY', {productId, lotId: id, row: index});
    } else {
      totalByProduct.set(productId, total);
    }
    if (qty < 0) oversoldLots++;
    if (qty > 0 && String(lot.Status || '').trim().toLowerCase() === 'deleted') {
      deletedPositiveLots++;
      addIssue('DELETED_POSITIVE_LOT', {productId, lotId: id, row: index});
    }
  }

  const productRows = products.map((product, index) => {
    const productId = identifier(product['Product ID']);
    const cachedStock = quantity(product['Current Stock']);
    const lotCount = countByProduct.get(productId) || 0;
    const invalid = !productId || cachedStock === null ||
      duplicateProducts.has(productId) || invalidLotQuantityProducts.has(productId);
    const lotStock = invalidLotQuantityProducts.has(productId)
      ? null : (lotCount ? (totalByProduct.get(productId) || 0) : null);
    let status, difference = null;
    if (invalid) {
      status = 'INVALID';
    } else if (!lotCount) {
      status = cachedStock === 0 ? 'NO_LOTS_ZERO' : 'NO_LOTS_NONZERO';
      if (status === 'NO_LOTS_NONZERO') {
        missingLotsNonzeroProducts++;
        addIssue('NO_LOTS_NONZERO', {productId, row: index});
      }
    } else {
      difference = lotStock - cachedStock;
      status = lotStock === cachedStock ? 'MATCH' : 'MISMATCH';
      if (status === 'MISMATCH') {
        mismatchedProducts++;
        addIssue('STOCK_MISMATCH', {productId, row: index});
      }
    }
    return {productId, cachedStock, lotStock, difference, lotCount, status};
  });

  return {
    ready: issues.length === 0,
    products: productRows,
    issues,
    summary: {
      productCount: products.length,
      lotCount: lots.length,
      mismatchedProducts,
      missingLotsNonzeroProducts,
      orphanLots,
      oversoldLots,
      deletedPositiveLots
    }
  };
}
