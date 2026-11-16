/**
 * M05 internal read-only FIFO preview eligibility gate.
 *
 * Frozen source StockLots.gs lets consumption draw Deleted positive lots,
 * while its pricing ladder excludes them. Refuse such an inconsistent
 * snapshot rather than silently modifying the source-faithful planners.
 *
 * Not a D1 posting plan, stock lock, POS entrypoint, RPC or authorization.
 * Real posting must separately prove status/quantity CAS in atomic SQL.
 */
import {
  buildLotPricingLadder_,
  planStockConsumption_,
  planSaleVendorConsumption_
} from './stock-fifo-planning.js';

export function planConsistentStockPreview({
  productId, quantity, allLots, productRow, vendorSourced = false
} = {}) {
  if (typeof productId !== 'string' || !productId.trim()) {
    throw new TypeError('Valid product ID required.');
  }
  if (!Array.isArray(allLots)) {
    throw new TypeError('Explicit lot snapshot required.');
  }
  if (!productRow || typeof productRow !== 'object') {
    throw new TypeError('Explicit product snapshot required.');
  }
  if (productRow['Product ID'] !== productId) {
    throw new Error('Product snapshot ID mismatch.');
  }
  if (
    !['number', 'string'].includes(typeof quantity) ||
    (typeof quantity === 'string' && !quantity.trim()) ||
    !Number.isFinite(Number(quantity)) ||
    Number(quantity) < 0
  ) {
    throw new TypeError('Quantity must be a finite nonnegative number.');
  }
  if (typeof vendorSourced !== 'boolean') {
    throw new TypeError('vendorSourced must be boolean.');
  }

  for (const lot of allLots) {
    if (!lot || typeof lot !== 'object') {
      throw new TypeError('Invalid lot snapshot row.');
    }
    if (
      lot['Product ID'] === productId &&
      Number(lot['Remaining Quantity']) > 0 &&
      String(lot.Status || '').trim().toLowerCase() === 'deleted'
    ) {
      throw new Error('Deleted positive-stock lot conflicts with FIFO price eligibility.');
    }
  }

  const consumption = vendorSourced
    ? planSaleVendorConsumption_(productId, Number(quantity), allLots, productRow)
    : planStockConsumption_(productId, Number(quantity), allLots, productRow);

  return {
    consumption,
    pricing: buildLotPricingLadder_(productId, allLots, productRow)
  };
}
