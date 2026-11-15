/**
 * M05 internal source-faithful FIFO lot planning port.
 * Pinned legacy/source/StockLots.gs, Utils.gs:
 * Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 *
 * Function declarations below are copied byte-for-byte from original GAS.
 * No DB binding, RPC routing, inventory mutation, sale or accounting writer.
 * Callers MUST supply trusted allLots and productRow snapshots explicitly.
 *
 * Source timezone: Asia/Dhaka (original CONFIG.DEFAULT_SETTINGS.Timezone).
 * This adapter's non-source date formatter is limited to this preflight.
 */

function formatDate_(value){
  const date=value instanceof Date?value:new Date(value);
  if(!Number.isFinite(date.getTime()))throw new TypeError('Invalid FIFO date');
  const parts=new Intl.DateTimeFormat('en-GB',{
    year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Dhaka'
  }).formatToParts(date);
  const fields=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return [fields.year,fields.month,fields.day].join('-');
}

function getAllRows_(){
  throw new Error('Explicit lot and product snapshots required; hidden GAS reads forbidden');
}

function isValidNonNegativeNumber_(value) {
  const n = Number(value);
  return !isNaN(n) && isFinite(n) && n >= 0;
}

function roundMoney_(value) {
  const n = Number(value) || 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function safeDateOnly_(value) {
  if (!value) return '';
  try { return formatDate_(value); } catch (e) { return String(value).slice(0, 10); }
}

function compareLotsFifo_(a, b) {
  const da = safeDateOnly_(a['Purchase Date']) || safeDateOnly_(a['Created At']) || '';
  const db = safeDateOnly_(b['Purchase Date']) || safeDateOnly_(b['Created At']) || '';
  if (da !== db) return da < db ? -1 : 1;
  return String(a['Lot ID']).localeCompare(String(b['Lot ID']));
}

function lotSellPrice_(lot, productRow) {
  const raw = lot ? lot['Sell Price'] : '';
  if (raw !== '' && raw !== null && raw !== undefined && isValidNonNegativeNumber_(raw)) {
    return Number(raw);
  }
  const fallback = productRow ? productRow['Selling Price'] : 0;
  return isValidNonNegativeNumber_(fallback) ? Number(fallback) : 0;
}

function buildLotPricingLadder_(productId, allLots, productRow) {
  const fallbackSellPrice = lotSellPrice_(null, productRow);
  const lots = (allLots || [])
    .filter(function (l) {
      return l['Product ID'] === productId && (Number(l['Remaining Quantity']) || 0) > 0 && l['Status'] !== 'Deleted';
    })
    .sort(compareLotsFifo_);
  const segments = [];
  lots.forEach(function (lot) {
    const qty = Number(lot['Remaining Quantity']) || 0;
    if (qty <= 0) return;
    const sellPrice = lotSellPrice_(lot, productRow);
    const prev = segments.length ? segments[segments.length - 1] : null;
    if (prev && Math.abs(prev.sellPrice - sellPrice) < 0.0000001) prev.qty += qty;
    else segments.push({ qty: qty, sellPrice: sellPrice });
  });
  return {
    segments: segments,
    fallbackSellPrice: fallbackSellPrice,
    autoSellingPrice: segments.length ? segments[0].sellPrice : fallbackSellPrice
  };
}

function computePlanSellingPrice_(plan, qty) {
  let total = 0;
  (plan.draws || []).forEach(function (d) {
    total += (Number(d.take) || 0) * (Number(d.unitSellPrice) || 0);
  });
  if ((Number(plan.shortfall) || 0) > 0) {
    total += (Number(plan.shortfall) || 0) * (Number(plan.fallbackSellPrice) || 0);
  }
  const lineTotal = roundMoney_(total);
  const quantity = Number(qty) || 0;
  return {
    unitPrice: quantity > 0 ? roundMoney_(lineTotal / quantity) : 0,
    lineTotal: lineTotal
  };
}

function planStockConsumption_(productId, qty, allLots, productRow) {
  let need = Number(qty) || 0;
  const product = productRow || getAllRows_('PRODUCTS').filter(function (p) { return p['Product ID'] === productId; })[0];
  const plan = {
    productId: productId, draws: [], shortfall: 0,
    fallbackPrice: product ? Number(product['Purchase Price']) || 0 : 0,
    fallbackSellPrice: product ? Number(product['Selling Price']) || 0 : 0,
    fallbackName: product ? product['Product Name'] : ''
  };
  if (need <= 0) return plan;

  const lots = (allLots || getAllRows_('STOCK_LOTS'))
    .filter(function (l) {
      return l['Product ID'] === productId && (Number(l['Remaining Quantity']) || 0) > 0;
    })
    .sort(compareLotsFifo_);

  for (let i = 0; i < lots.length && need > 0; i++) {
    const lot = lots[i];
    const available = Number(lot['Remaining Quantity']) || 0;
    const take = Math.min(available, need);
    if (take <= 0) continue;
    plan.draws.push({
      lotId: lot['Lot ID'],
      rowIndex: lot._rowIndex,
      take: take,
      unitCost: Number(lot['Purchase Price']) || 0,
      unitSellPrice: lotSellPrice_(lot, product),
      remainingAfter: available - take
    });
    need -= take;
  }

  if (need > 0) {
    // The product does not have enough physical stock. POS deliberately allows
    // selling past zero, so the shortfall becomes an OVERSOLD lot.
    // zero (see completeSale/updateSale). Recorded as a shortfall now;
    // applyStockConsumption_ back-fills a lot rather than blocking the sale.
    plan.shortfall = need;
  }
  return plan;
}

function planSaleVendorConsumption_(productId, qty, allLots, productRow) {
  const requested = Number(qty) || 0;
  const product = productRow || getAllRows_('PRODUCTS').filter(function (p) { return p['Product ID'] === productId; })[0];
  if (requested <= 0) return planStockConsumption_(productId, 0, allLots, product);

  const netOwnedAvailable = Math.max(0, product ? (Number(product['Current Stock']) || 0) : 0);
  const ownTarget = Math.min(requested, netOwnedAvailable);
  const plan = planStockConsumption_(productId, ownTarget, allLots, product);
  const ownDrawn = plan.draws.reduce(function (sum, d) { return sum + (Number(d.take) || 0); }, 0);

  // Any part of the requested sale that cannot be backed by the shop's NET
  // owned stock is the vendor shortage. Do not leave planStockConsumption_'s
  // own shortfall here: completeSale/updateSale will neutralize this amount
  // into VENDOR_SOURCING before applyStockConsumption_ writes anything.
  plan.shortfall = Math.max(0, requested - ownDrawn);
  return plan;
}

export {
  isValidNonNegativeNumber_,roundMoney_,safeDateOnly_,
  compareLotsFifo_,lotSellPrice_,buildLotPricingLadder_,
  computePlanSellingPrice_,planStockConsumption_,planSaleVendorConsumption_,
};
