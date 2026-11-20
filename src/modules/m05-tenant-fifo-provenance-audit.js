/**
 * M05 internal, READ-ONLY tenant-scoped purchase / stock / FIFO evidence gate.
 *
 * Composes already-reviewed source contract auditors; does not infer Party
 * links, issue source IDs, settle OVERSOLD, authorize sales, round currency
 * or transact D1. All rows must be trusted, explicitly tenant-scoped inputs.
 * Frozen source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 */
import {auditPurchaseLotLineage} from './m05-purchase-lot-lineage.js';
import {auditPurchaseStockMovementProvenance} from './m05-purchase-stock-movement-provenance.js';
import {auditSourceStockLotBalances} from './m05-source-lot-reconciliation.js';
import {planNetOwnedStockPreview} from './m05-net-stock-fifo-preview.js';

const isPlain = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null) &&
    Reflect.ownKeys(value).every(key => {
      const d = Object.getOwnPropertyDescriptor(value, key);
      return typeof key === 'string' && Object.hasOwn(d, 'value');
    });
};

function trustedRows(snapshot, key) {
  const value = snapshot[key];
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError('Explicit trusted ' + key + ' snapshot array required');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let i = 0; i < value.length; i++) {
    if (!Object.hasOwn(descriptors, String(i)) ||
        !Object.hasOwn(descriptors[String(i)], 'value') ||
        !isPlain(value[i])) {
      throw new TypeError('Invalid ' + key + ' row or accessor');
    }
  }
  if (Reflect.ownKeys(descriptors).some(key =>
    key !== 'length' && (typeof key !== 'string' ||
      !/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))) {
    throw new TypeError('Untrusted ' + key + ' array field or accessor');
  }
  return value;
}

const validId = value => typeof value === 'string' && value.length > 0 &&
  value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);

/**
 * @param {object} snapshot Entire, explicitly trusted one-tenant/one-product evidence.
 * @returns {object} Review-only results. No posting permission is ever returned.
 */
export function auditTenantPurchaseFifoEvidence(snapshot) {
  if (!isPlain(snapshot)) throw new TypeError('Trusted tenant purchase snapshot required');
  const {tenantId, productId, requestedQty, productRow, vendorSourced = false} = snapshot;
  if (!validId(tenantId)) throw new TypeError('Valid tenant ID required');
  if (!validId(productId)) throw new TypeError('Valid product ID required');
  if (typeof requestedQty !== 'number' || !Number.isFinite(requestedQty) ||
      requestedQty < 0) throw new TypeError('Valid finite nonnegative requested quantity required');
  if (typeof vendorSourced !== 'boolean') throw new TypeError('vendorSourced must be boolean');
  if (!isPlain(productRow)) throw new TypeError('Explicit trusted product row required');

  const purchases = trustedRows(snapshot, 'purchases');
  const purchaseItems = trustedRows(snapshot, 'purchaseItems');
  const stockLots = trustedRows(snapshot, 'stockLots');
  const stockMovements = trustedRows(snapshot, 'stockMovements');
  const issues = [];

  function verifyScope(row, collection, index, expectProduct) {
    if (row['Tenant ID'] !== tenantId)
      issues.push({code: 'TENANT_SCOPE_MISMATCH', collection, row: index});
    if (expectProduct && row['Product ID'] !== productId)
      issues.push({code: 'PRODUCT_SCOPE_MISMATCH', collection, row: index});
  }

  verifyScope(productRow, 'productRow', 0, true);
  for (const [collection, entries, expectProduct] of [
    ['purchases', purchases, false],
    ['purchaseItems', purchaseItems, true],
    ['stockLots', stockLots, true],
    ['stockMovements', stockMovements, true]
  ]) {
    entries.forEach((row, index) => verifyScope(row, collection, index, expectProduct));
  }

  // Foreign-scope evidence is NEVER silently excluded to form a false clean
  // result; no downstream FIFO planner sees any cross-tenant source data.
  if (issues.length) {
    return {auditPassed: false, issues, stock: null, lotLineage: null,
      purchaseMovements: null, fifo: null, postingAllowed: false};
  }

  const stock = auditSourceStockLotBalances({products: [productRow], stockLots});
  const lotLineage = auditPurchaseLotLineage({purchases, purchaseItems, stockLots});
  const purchaseMovements = auditPurchaseStockMovementProvenance({
    purchases, purchaseItems, stockMovements
  });
  for (const [source, report] of [
    ['stock', stock], ['purchaseLotLineage', lotLineage],
    ['purchaseStockMovements', purchaseMovements]
  ]) {
    for (const issue of report.issues) issues.push({...issue, source});
  }

  let fifo = null;
  if (!issues.length) {
    try {
      fifo = planNetOwnedStockPreview({
        productId, quantity: requestedQty, allLots: stockLots,
        productRow, vendorSourced
      });
    } catch {
      issues.push({code: 'FIFO_PREVIEW_BLOCKED'});
    }
  }
  return {auditPassed: issues.length === 0, issues, stock, lotLineage,
    purchaseMovements, fifo, postingAllowed: false};
}
