/**
 * M05 internal READ-ONLY historical Purchase Item / stock-lot handoff check.
 * Pinned original Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * and approved supplementary unit model sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c.
 *
 * Source authorship, immutable supplementary receipts, tenant authorization,
 * and actual D1 posting remain external unapproved integration gates.
 * Never use current Unit catalog rows to reinterpret historical purchases.
 */
import {auditMultiUnitPurchaseSnapshot} from './m05-purchase-unit-snapshot-conservation.js';
import {auditPurchaseLotLineage} from './m05-purchase-lot-lineage.js';

const PLAIN = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
   Object.getPrototypeOf(value) === null);

function trustedTree(value, label, seen = new Set(), depth = 0) {
  if (typeof value === 'function' || typeof value === 'symbol')
    throw new TypeError('Invalid trusted ' + label + ' callable or symbol field');
  if (value === null || typeof value !== 'object') return;
  if (depth > 12 || seen.has(value)) throw new TypeError('Invalid circular/deep ' + label);
  seen.add(value);
  const array = Array.isArray(value);
  if (!array && !PLAIN(value)) throw new TypeError('Invalid trusted ' + label + ' record');
  if (array && (Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > 1000)) throw new TypeError('Invalid trusted ' + label + ' array');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (array) {
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(descriptors, String(index)))
        throw new TypeError('Sparse ' + label + ' array');
    }
  }
  for (const key of Reflect.ownKeys(descriptors)) {
    if (array && key === 'length') continue;
    const d = descriptors[key];
    if (typeof key !== 'string' || !Object.hasOwn(d, 'value') ||
      (array && (!/^(?:0|[1-9][0-9]*)$/.test(key) ||
        Number(key) >= value.length))) {
      throw new TypeError('Invalid trusted ' + label + ' accessor or array property');
    }
    trustedTree(d.value, label, seen, depth + 1);
  }
  seen.delete(value);
}

function id(value) {
  return typeof value === 'string' && value.length > 0 &&
    value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
}

function storedNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Exact evidence comparison, NOT a historical currency rounding policy.
function equalData(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((x, i) => equalData(x, right[i]));
  }
  if (!PLAIN(left) || !PLAIN(right)) return false;
  const leftKeys = Object.keys(left), rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length &&
    leftKeys.every(key => Object.hasOwn(right, key) &&
      equalData(left[key], right[key]));
}

// A historical receipt must not share any mutable container with the
// preflight record it independently corroborates, even several levels deep.
// Input shape and acyclicity were already checked by trustedTree.
function sharesUnitObject(left, right) {
  const originals = new WeakSet();
  function collect(value) {
    if (value === null || typeof value !== 'object') return;
    originals.add(value);
    for (const child of Object.values(value)) collect(child);
  }
  function overlaps(value) {
    if (value === null || typeof value !== 'object') return false;
    if (originals.has(value)) return true;
    return Object.values(value).some(overlaps);
  }
  collect(left);
  return overlaps(right);
}

/**
 * Explicit *trusted* one-purchase source/receipt snapshot.
 * This gate does not issue an operation ID, approve a purchase or write data.
 */
export function auditHistoricalUnitLotHandoff(snapshot) {
  if (!PLAIN(snapshot)) throw new TypeError('Trusted historical handoff snapshot required');
  trustedTree(snapshot, 'historical unit/lot');
  const {tenantId, purchaseId, purchaseHeader, preflight,
    purchaseItems, stockLots, unitReceipts} = snapshot;
  if (!id(tenantId)) throw new TypeError('Valid tenant ID required');
  if (!id(purchaseId)) throw new TypeError('Valid Purchase ID required');
  if (!PLAIN(purchaseHeader) || !PLAIN(preflight) ||
    !Array.isArray(preflight.lines) || !Array.isArray(purchaseItems) ||
    !Array.isArray(stockLots) || !Array.isArray(unitReceipts))
    throw new TypeError('Explicit trusted purchase, lines, lots and unit receipts required');

  const issues = [];
  const issue = (code, details = {}) => issues.push({code, ...details});
  const blocked = () => ({
    ready:false,issues,unitAudit:null,lotAudit:null,
    checkedProducts:0,postingAllowed:false
  });

  if (purchaseHeader['Tenant ID'] !== tenantId)
    issue('TENANT_SCOPE_MISMATCH', {source:'purchaseHeader'});
  if (purchaseHeader['Purchase ID'] !== purchaseId)
    issue('PURCHASE_SCOPE_MISMATCH', {source:'purchaseHeader'});
  if (!id(purchaseHeader['Supplier ID']) || preflight.supplierId !== purchaseHeader['Supplier ID'])
    issue('SUPPLIER_ID_MISMATCH');
  if (String(purchaseHeader['Is Deleted'] ?? '').toUpperCase() === 'TRUE')
    issue('DELETED_PURCHASE_REVIEW');

  const sourceRows = [
    ['purchaseItems',purchaseItems], ['stockLots',stockLots],
    ['unitReceipts',unitReceipts]
  ];
  for (const [source, rows] of sourceRows) {
    for (const row of rows) {
      const tenant = source === 'unitReceipts' ? row.tenantId : row['Tenant ID'];
      const purchase = source === 'unitReceipts' ? row.purchaseId : row['Purchase ID'];
      if (tenant !== tenantId) issue('TENANT_SCOPE_MISMATCH', {source});
      if (purchase !== purchaseId) issue('PURCHASE_SCOPE_MISMATCH', {source});
    }
  }
  // Do not give cross-tenant or wrong-purchase records to original-source
  // auditors. Purchase/Supplier mismatch also blocks downstream use.
  if (issues.length) return blocked();

  const unitAudit = auditMultiUnitPurchaseSnapshot(preflight);
  const lotAudit = auditPurchaseLotLineage({
    purchases:[purchaseHeader],purchaseItems,stockLots
  });
  for (const entry of unitAudit.issues)
    issue(entry.code, {...entry, source:'unitSnapshot'});
  for (const entry of lotAudit.issues)
    issue(entry.code, {...entry, source:'purchaseLotLineage'});

  const sourceLines = new Map(), itemsByProduct = new Map();
  for (const line of preflight.lines) {
    if (!id(line.productId)) continue; // Existing source validator reports it.
    if (!sourceLines.has(line.productId)) sourceLines.set(line.productId, line);
  }
  for (const item of purchaseItems) {
    const productId = item['Product ID'];
    if (!sourceLines.has(productId))
      issue('UNEXPECTED_STORED_PRODUCT', {productId});
    else if (!itemsByProduct.has(productId))
      itemsByProduct.set(productId, item);
  }
  for (const [productId, line] of sourceLines) {
    const stored = itemsByProduct.get(productId);
    if (!stored) {
      issue('MISSING_STORED_PRODUCT', {productId});
      continue;
    }
    if (storedNumber(stored.Quantity) !== line.qty)
      issue('STORED_QUANTITY_MISMATCH', {productId});
    if (storedNumber(stored['Unit Price']) !== line.price)
      issue('STORED_UNIT_COST_MISMATCH', {productId});
  }

  const receipts = new Map();
  for (const receipt of unitReceipts) {
    const productId = receipt.productId;
    if (!id(productId) || !sourceLines.has(productId)) {
      issue('UNEXPECTED_UNIT_RECEIPT', {productId});
      continue;
    }
    if (receipts.has(productId)) {
      issue('DUPLICATE_UNIT_RECEIPT', {productId});
      continue;
    }
    receipts.set(productId, receipt);
  }

  for (const [productId, line] of sourceLines) {
    const hasUnit = Object.hasOwn(line,'unit');
    const receipt = receipts.get(productId);
    if (!hasUnit) {
      if (receipt) issue('UNEXPECTED_UNIT_RECEIPT', {productId});
    } else if (!receipt) {
      issue('MISSING_UNIT_RECEIPT', {productId});
    } else if (sharesUnitObject(receipt.unit, line.unit)) {
      issue('UNIT_RECEIPT_ALIASED', {productId});
    } else if (!equalData(receipt.unit, line.unit)) {
      issue('UNIT_RECEIPT_MISMATCH', {productId});
    }
  }

  return {ready:issues.length===0, issues, unitAudit, lotAudit,
    checkedProducts:issues.length===0 ? sourceLines.size : 0,
    postingAllowed:false};
}
