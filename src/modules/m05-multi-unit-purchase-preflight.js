/**
 * M05 internal, READ-ONLY multi-unit purchase preflight.
 *
 * Compose the unchanged Mohim_ERP purchase validator with the approved
 * sherERP_Mohim source-compatible unit quantity and cost calculations.
 * This function does not authorize, lock, post, persist or expose an RPC.
 *
 * Caller must supply trusted snapshot arrays. Real Workerd/D1 posting must
 * recompute them inside a guarded SQL transaction and record historical
 * unit/factor/price snapshots with stock, cash and supplier obligations.
 */
import {preparePurchasePreflight} from './purchase-preflight.js';
import {
  resolveProductUnitBreakdown_,
  computeUnitBreakdownPurchasePricing_
} from './product-unit-conversions.js';

export function prepareMultiUnitPurchasePreflight(
  payload,
  {products, suppliers, conversionRows} = {}
) {
  if (!Array.isArray(products)) throw new TypeError('Explicit product snapshot required.');
  if (!Array.isArray(suppliers)) throw new TypeError('Explicit supplier snapshot required.');
  if (!Array.isArray(conversionRows)) throw new TypeError('Explicit conversion snapshot required.');

  // Keep the original missing-supplier / missing-item validation unchanged.
  if (!payload || !Array.isArray(payload.items)) {
    return preparePurchasePreflight(payload, {products, suppliers});
  }

  const productsById = new Map(products.map(product => [product['Product ID'], product]));
  const unitByLine = [];
  const items = payload.items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError('Line ' + (index + 1) + ': purchase item is required.');
    }
    const rawBreakdown = item.unitBreakdown;
    if (rawBreakdown !== undefined && rawBreakdown !== null && !Array.isArray(rawBreakdown)) {
      throw new TypeError('Line ' + (index + 1) + ': unit breakdown must be an array.');
    }

    // Preserve the original, editable single-unit purchase contract exactly.
    if (!Array.isArray(rawBreakdown) || rawBreakdown.length === 0) {
      unitByLine.push(null);
      return item;
    }

    const product = productsById.get(item.productId);
    if (!product ||
      String(product['Is Deleted'] ?? '').toLowerCase() === 'true' ||
      String(product['Product Type'] || '').trim() === 'Bundle') {
      // Let the original preflight emit its source-compatible error message.
      unitByLine.push(null);
      return item;
    }

    // Browser-supplied factors, prices and labels are not authoritative.
    const normalized = resolveProductUnitBreakdown_(
      product, rawBreakdown, item.qty, conversionRows
    );
    const pricing = computeUnitBreakdownPurchasePricing_(
      normalized, product, conversionRows
    );

    unitByLine.push({
      stockUnit: String(product.Unit || ''),
      lineTotal: pricing.lineTotal,
      unitSnapshot: normalized.snapshot,
      pricingSnapshot: pricing.pricingSnapshot
    });
    return {
      ...item,
      name: product['Product Name'],
      qty: normalized.baseQty,
      unitPrice: pricing.unitPrice,
      // The original purchase validator accepts an editable lot selling
      // price; keep that behavior, defaulting only when it is absent.
      sellingPrice: item.sellingPrice ?? product['Selling Price'] ?? 0
    };
  });

  const source = preparePurchasePreflight(
    {...payload, items},
    {products, suppliers}
  );
  return {
    ...source,
    lines: source.lines.map((line, index) => unitByLine[index]
      ? {...line, unit: unitByLine[index]}
      : line)
  };
}
