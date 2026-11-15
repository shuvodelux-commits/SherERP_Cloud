/**
 * M06 pure physical-demand port for read-only mixed POS profit previews.
 * The function below is byte-for-byte copied from pinned
 * Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * legacy/source/Bundles.gs::buildSaleStockDemands_.
 * NO stock writes, auth, RPC, D1, lot reservation or financial posting.
 */

function buildSaleStockDemands_(displayLines, definitions, historicalSnapshots) {
  const requirementsByProductId = {}, ownersByProductId = {};
  function add(source, physical, qty) {
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('Invalid physical stock demand.');
    requirementsByProductId[physical] = (requirementsByProductId[physical] || 0) + qty;
    if (!Number.isFinite(requirementsByProductId[physical])) throw new Error('Stock demand exceeds supported amount.');
    if (!ownersByProductId[physical]) ownersByProductId[physical] = [];
    ownersByProductId[physical].push({sourceSaleProductId: source, physicalProductId: physical, qty: qty});
  }
  (displayLines || []).forEach(function (line) {
    const id = String(line.productId || '');
    const qty = Number(line.qty);
    if (!id || !Number.isFinite(qty) || qty <= 0) throw new Error('Invalid sale item quantity.');
    if (line.productType === 'Bundle') {
      if (!Number.isSafeInteger(qty)) throw new Error('Bundle must be sold in whole sets.');
      const recipe = historicalSnapshots && historicalSnapshots[id] || definitions && definitions[id];
      if (!recipe || !recipe.components || !recipe.components.length) throw new Error('Missing bundle definition: ' + id);
      recipe.components.forEach(function (component) { add(id, component.productId, qty * component.qtyPerSet); });
    } else {
      add(id, id, qty);
    }
  });
  return {requirementsByProductId: requirementsByProductId, ownersByProductId: ownersByProductId};
}

export {buildSaleStockDemands_};
