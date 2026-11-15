/**
 * Internal, read-only M05 purchase preflight based on the validation half of
 * pinned legacy/source/Purchase.gs::createPurchase.
 *
 * Explicit GAS-shaped snapshots only. NOT a posting plan, D1 transaction,
 * authorization check, Cash Session check or public RPC. Current Stock is a
 * stale-able observation; a real writer must use guarded atomic D1 updates.
 */
const validNonNegative = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
};

const deleted = (row) => String(row?.['Is Deleted'] ?? '').toLowerCase() === 'true';

export function preparePurchasePreflight(payload, { products, suppliers }) {
  if (!payload?.supplierId) throw new Error('Choose a supplier.');
  if (!Array.isArray(payload.items) || !payload.items.length) {
    throw new Error('Add at least one product line.');
  }

  const supplier = suppliers.find((row) =>
    row['Supplier ID'] === payload.supplierId && !deleted(row));
  if (!supplier || supplier.Status === 'Inactive') {
    throw new Error('Supplier not found or inactive.');
  }

  // Source createPurchase builds a product lookup once for the whole basket.
  const productsById = new Map(products.map((row) => [row['Product ID'], row]));
  const seen = new Set();
  const lines = [];
  let subtotal = 0;

  payload.items.forEach((item, index) => {
    const qty = Number(item.qty);
    const price = Number(item.unitPrice);
    const sellPrice = Number(item.sellingPrice);
    if (!validNonNegative(qty) || qty <= 0) {
      throw new Error('Line ' + (index + 1) + ': quantity must be greater than zero.');
    }
    if (!validNonNegative(price)) {
      throw new Error('Line ' + (index + 1) + ': unit price must be a valid number.');
    }
    if (!validNonNegative(sellPrice)) {
      throw new Error('Line ' + (index + 1) + ': sell price must be a valid number.');
    }
    if (seen.has(item.productId)) {
      throw new Error(item.name + ' appears more than once — combine it into one line.');
    }
    seen.add(item.productId);

    const product = productsById.get(item.productId);
    if (!product || deleted(product)) {
      throw new Error('Product ' + item.name + ' no longer exists.');
    }
    if (String(product['Product Type'] || '').trim() === 'Bundle') {
      throw new Error('Virtual bundle sets cannot be purchased as physical stock. Purchase the component products.');
    }

    const currentStock = Number(product['Current Stock']) || 0;
    lines.push({
      productId: item.productId,
      name: item.name,
      qty,
      price,
      sellPrice,
      rowIndex: product._rowIndex,
      currentStock,
      newStock: currentStock + qty
    });
    subtotal += qty * price;
  });

  // Keep original preflight arithmetic; integer-paisa posting remains gated.
  const discount = validNonNegative(payload.discount) ? Number(payload.discount) : 0;
  const grandTotal = Math.max(0, subtotal - discount);
  let paidAmount = validNonNegative(payload.paidAmount) ? Number(payload.paidAmount) : 0;
  if (paidAmount > grandTotal) paidAmount = grandTotal;
  const dueAmount = grandTotal - paidAmount;
  const paymentStatus = dueAmount <= 0 ? 'Paid' : (paidAmount > 0 ? 'Partial' : 'Due');

  return {
    supplierId: payload.supplierId,
    supplierName: supplier['Supplier Name'],
    lines,
    subtotal,
    discount,
    grandTotal,
    paidAmount,
    dueAmount,
    paymentStatus
  };
}
