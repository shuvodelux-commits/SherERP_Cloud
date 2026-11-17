/**
 * M05 trusted-input-only Product Unit Price Profile.
 * Source function bodies mechanically copied, unchanged, from
 * shuvodelux-commits/sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c
 * ProductUnitConversions.gs::productUnitOptionalPrice_ and
 * ProductUnitConversions.gs::normalizeProductPriceProfile_.
 *
 * sanitizeInput_ replaces the original GAS global utility.
 * No authorization, SQL, RPC, D1 write, stock, cash or Party mutation.
 * Real Product Add/Edit requires separate M02/M03/M04 reviewed D1 contract.
 */
const sanitizeInput_=value=>String(value===null||value===undefined?'':value).trim();

function productUnitOptionalPrice_(value, unitName, label) {
  if (value === "" || value === null || value === undefined) return "";
  const n = Number(value);
  if (!isFinite(n) || n < 0) {
    throw new Error(unitName + ": " + label + " must be zero or greater.");
  }
  return n;
}

function normalizeProductPriceProfile_(stockUnit, conversions, payload) {
  const stock = sanitizeInput_(stockUnit);
  if (!stock) throw new Error("Stock unit is required.");
  const cleanConversions = (conversions || []).map(function (item) {
    return {
      id: sanitizeInput_(item && item.id),
      unitName: sanitizeInput_(item && item.unitName),
      factor: Number(item && item.factor) || 0,
      relationQty: item && item.relationQty !== undefined ? Number(item.relationQty) : "",
      relationUnitName: sanitizeInput_(item && item.relationUnitName),
      purchasePrice: productUnitOptionalPrice_(item && item.purchasePrice, sanitizeInput_(item && item.unitName), "purchase price"),
      sellingPrice: productUnitOptionalPrice_(item && item.sellingPrice, sanitizeInput_(item && item.unitName), "selling price"),
      sortOrder: Number(item && item.sortOrder) || 0,
      status: "Active"
    };
  });
  const factorByName = {};
  factorByName[stock.toLowerCase()] = 1;
  cleanConversions.forEach(function (item) {
    if (!item.unitName || !isFinite(item.factor) || item.factor <= 0) {
      throw new Error("Every configured unit must have a valid conversion factor.");
    }
    factorByName[item.unitName.toLowerCase()] = item.factor;
  });

  const source = payload || {};
  const purchasePrice = Number(source.purchasePrice);
  const sellingPrice = Number(source.sellingPrice);
  if (!isFinite(purchasePrice) || purchasePrice < 0) throw new Error("Purchase price must be a valid number.");
  if (!isFinite(sellingPrice) || sellingPrice < 0) throw new Error("Selling price must be a valid number.");

  const purchasePriceUnit = sanitizeInput_(source.purchasePriceUnit) || stock;
  const sellingPriceUnit = sanitizeInput_(source.sellingPriceUnit) || stock;
  const purchaseFactor = factorByName[purchasePriceUnit.toLowerCase()];
  const sellingFactor = factorByName[sellingPriceUnit.toLowerCase()];
  if (!purchaseFactor) throw new Error(purchasePriceUnit + ": purchase price unit is not configured for this product.");
  if (!sellingFactor) throw new Error(sellingPriceUnit + ": selling price unit is not configured for this product.");

  const byName = {};
  cleanConversions.forEach(function (item) { byName[item.unitName.toLowerCase()] = item; });
  let stockPurchaseOverride = "";
  let stockSellingOverride = "";

  (Array.isArray(source.unitPriceOverrides) ? source.unitPriceOverrides : []).forEach(function (raw) {
    raw = raw || {};
    const unitName = sanitizeInput_(raw.unitName);
    if (!unitName) throw new Error("Unit price override requires a unit.");
    const key = unitName.toLowerCase();
    if (!factorByName[key]) throw new Error(unitName + ": unit price override is not configured for this product.");
    const purchaseOverride = productUnitOptionalPrice_(raw.purchasePrice, unitName, "purchase price");
    const sellingOverride = productUnitOptionalPrice_(raw.sellingPrice, unitName, "selling price");

    if (purchaseOverride !== "" && key === purchasePriceUnit.toLowerCase()) {
      throw new Error(unitName + ": use the main Purchase Price field for the anchor unit.");
    }
    if (sellingOverride !== "" && key === sellingPriceUnit.toLowerCase()) {
      throw new Error(unitName + ": use the main Selling Price field for the anchor unit.");
    }

    if (key === stock.toLowerCase()) {
      if (purchaseOverride !== "") stockPurchaseOverride = purchaseOverride;
      if (sellingOverride !== "") stockSellingOverride = sellingOverride;
      return;
    }
    const target = byName[key];
    if (!target) throw new Error(unitName + ": unit price override is not configured for this product.");
    if (purchaseOverride !== "") target.purchasePrice = purchaseOverride;
    else target.purchasePrice = "";
    if (sellingOverride !== "") target.sellingPrice = sellingOverride;
    else target.sellingPrice = "";
  });

  // Keep the user-entered price-unit value exact. The canonical stock-unit
  // price may need more than two decimals (for example ৳70 / 16 Gira =
  // 4.375). Rounding that storage value and multiplying it back is what
  // turned ৳70 into ৳70.08 on the next edit.
  //
  // Also keep the exact anchor price on its conversion row. That gives UI
  // and transaction screens a lossless source-unit value while all stock,
  // FIFO and line-price calculations can continue using the canonical base
  // price.
  if (purchasePriceUnit.toLowerCase() !== stock.toLowerCase()) {
    const purchaseAnchor = byName[purchasePriceUnit.toLowerCase()];
    if (purchaseAnchor) purchaseAnchor.purchasePrice = purchasePrice;
  }
  if (sellingPriceUnit.toLowerCase() !== stock.toLowerCase()) {
    const sellingAnchor = byName[sellingPriceUnit.toLowerCase()];
    if (sellingAnchor) sellingAnchor.sellingPrice = sellingPrice;
  }

  return {
    purchaseBasePrice: purchasePrice / purchaseFactor,
    sellingBasePrice: sellingPrice / sellingFactor,
    purchasePriceUnit: purchasePriceUnit,
    sellingPriceUnit: sellingPriceUnit,
    stockPurchaseOverride: stockPurchaseOverride,
    stockSellingOverride: stockSellingOverride,
    conversions: cleanConversions
  };
}

export { normalizeProductPriceProfile_ };
