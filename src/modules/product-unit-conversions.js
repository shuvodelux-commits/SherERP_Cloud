/**
 * INTERNAL M05/M06 pure multi-unit quantity and price calculations.
 * Source-adapted function bodies: sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c
 * ProductUnitConversions.gs (approved natural chain, units and pricing).
 *
 * Original Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2 remains
 * authoritative for existing stock, lot, purchase, sale, Party and cash logic.
 * NO Sheets calls, DB binding, RPC route, posting, auth or mutation here.
 * A future M04-authorized writer MUST read active product/conversion rows
 * from D1, recompute base quantities and store immutable historical unit
 * and pricing snapshots atomically with stock, FIFO, cash and ledger writes.
 *
 * Source utility adapters replace GAS global sanitizeInput_ and roundMoney_.
 * Function bodies otherwise mechanically copied, not rewritten, to retain
 * the original source unit and FIFO pricing behavior.
 */
const sanitizeInput_=value=>String(value===null||value===undefined?'':value).trim();
const roundMoney_=value=>{
  const number=Number(value)||0;
  return Math.round((number+Number.EPSILON)*100)/100;
};

function productUnitConversionSort_(a, b) {
  const ao = Number(a && (a["Sort Order"] !== undefined ? a["Sort Order"] : a.sortOrder)) || 0;
  const bo = Number(b && (b["Sort Order"] !== undefined ? b["Sort Order"] : b.sortOrder)) || 0;
  if (ao !== bo) return ao - bo;
  const ai = String(a && (a["Conversion ID"] || a.id) || "");
  const bi = String(b && (b["Conversion ID"] || b.id) || "");
  return ai.localeCompare(bi);
}

function normalizeProductUnitChain_(rawRelations, masterRows, allowedExistingNames) {
  const relations = Array.isArray(rawRelations) ? rawRelations : [];
  if (!relations.length) return { stockUnit: "", relations: [], conversions: [] };

  const active = {};
  (masterRows || []).forEach(function (row) {
    const name = sanitizeInput_(row && row["Unit Name"]);
    if (!name || String(row["Status"] || "Active") === "Inactive") return;
    active[name.toLowerCase()] = name;
  });
  const allowed = {};
  (allowedExistingNames || []).forEach(function (name) {
    const cleaned = sanitizeInput_(name);
    if (cleaned) allowed[cleaned.toLowerCase()] = cleaned;
  });

  function requireManaged_(name) {
    const key = name.toLowerCase();
    if (!active[key] && !allowed[key]) {
      throw new Error(name + ": unit must be an active Product Unit.");
    }
  }

  const normalized = [];
  const chainUnits = [];
  let previousRightKey = "";

  relations.forEach(function (raw, index) {
    raw = raw || {};
    const leftQty = Number(raw.leftQty);
    const rightQty = Number(raw.rightQty);
    const leftUnit = sanitizeInput_(raw.leftUnit);
    const rightUnit = sanitizeInput_(raw.rightUnit);
    if (!isFinite(leftQty) || leftQty <= 0 || !isFinite(rightQty) || rightQty <= 0) {
      throw new Error("Unit quantities must be greater than zero.");
    }
    if (!leftUnit || !rightUnit) throw new Error("Both units are required.");
    const leftKey = leftUnit.toLowerCase();
    const rightKey = rightUnit.toLowerCase();
    if (leftKey === rightKey) throw new Error("Each relationship must use a different unit.");
    requireManaged_(leftUnit);
    requireManaged_(rightUnit);

    if (index > 0 && leftKey !== previousRightKey) {
      throw new Error("Unit relationships must form one connected chain.");
    }
    if (chainUnits.indexOf(leftKey) !== -1 && !(index > 0 && chainUnits[chainUnits.length - 1] === leftKey)) {
      throw new Error("Circular or duplicate unit relationship.");
    }
    if (chainUnits.indexOf(rightKey) !== -1) {
      throw new Error("Circular or duplicate unit relationship.");
    }

    if (!chainUnits.length) chainUnits.push(leftKey);
    chainUnits.push(rightKey);
    previousRightKey = rightKey;

    const ratio = rightQty / leftQty;
    if (!isFinite(ratio) || ratio <= 0) throw new Error("Unit quantities must be greater than zero.");
    normalized.push({
      leftQty: 1,
      leftUnit: leftUnit,
      rightQty: ratio,
      rightUnit: rightUnit,
      sortOrder: index + 1
    });
  });

  const stockUnit = normalized[normalized.length - 1].rightUnit;
  const factorByKey = {};
  factorByKey[stockUnit.toLowerCase()] = 1;
  for (let i = normalized.length - 1; i >= 0; i--) {
    const rel = normalized[i];
    const rightFactor = factorByKey[rel.rightUnit.toLowerCase()];
    factorByKey[rel.leftUnit.toLowerCase()] = rel.rightQty * rightFactor;
  }

  const conversions = normalized.map(function (rel) {
    return {
      unitName: rel.leftUnit,
      factor: factorByKey[rel.leftUnit.toLowerCase()],
      relationQty: rel.rightQty,
      relationUnitName: rel.rightUnit,
      sortOrder: rel.sortOrder
    };
  });

  return { stockUnit: stockUnit, relations: normalized, conversions: conversions };
}

function productUnitConversionCatalog_(product, conversionRows, options) {
  const opts = options || {};
  if (Array.isArray(opts.catalog)) return opts.catalog.slice();

  const productId = String(product && product["Product ID"] || "");
  return (conversionRows || []).filter(function (row) {
    if (String(row["Product ID"] || "") !== productId) return false;
    return opts.allowInactive || String(row["Status"] || "Active") !== "Inactive";
  }).slice().sort(productUnitConversionSort_).map(function (row) {
    const factor = Number(row["Conversion Factor"]) || 0;
    const relationQtyRaw = row["Relation Qty"];
    const relationUnitRaw = row["Relation Unit Name"];
    return {
      conversionId: String(row["Conversion ID"] || ""),
      unitName: String(row["Unit Name"] || ""),
      factor: factor,
      relationQty: relationQtyRaw === "" || relationQtyRaw === null || relationQtyRaw === undefined
        ? factor
        : Number(relationQtyRaw),
      relationUnitName: sanitizeInput_(relationUnitRaw) || sanitizeInput_(product && product["Unit"]),
      purchasePrice: row["Purchase Price"] === "" || row["Purchase Price"] === null || row["Purchase Price"] === undefined
        ? ""
        : Number(row["Purchase Price"]),
      sellingPrice: row["Selling Price"] === "" || row["Selling Price"] === null || row["Selling Price"] === undefined
        ? ""
        : Number(row["Selling Price"]),
      sortOrder: Number(row["Sort Order"]) || 0,
      status: row["Status"] || "Active"
    };
  });
}

function resolveProductUnitBreakdown_(product, rawBreakdown, claimedQty, conversionRows, options) {
  const opts = options || {};
  const breakdown = Array.isArray(rawBreakdown) ? rawBreakdown : [];
  if (!breakdown.length) {
    const legacyQty = Number(claimedQty);
    if (!isFinite(legacyQty) || legacyQty <= 0) throw new Error("Quantity must be greater than zero.");
    return { baseQty: legacyQty, snapshot: [], components: [], hasBreakdown: false };
  }

  const baseUnit = sanitizeInput_(product && product["Unit"]);
  const catalog = productUnitConversionCatalog_(product, conversionRows, opts);
  const byId = {};
  catalog.forEach(function (item) {
    if (item.conversionId) byId[item.conversionId] = item;
  });

  const entered = {};
  breakdown.forEach(function (raw) {
    raw = raw || {};
    const conversionId = sanitizeInput_(raw.conversionId);
    if (!conversionId) throw new Error("Conversion ID is required.");
    if (entered[conversionId] !== undefined) throw new Error("Duplicate unit in quantity breakdown.");
    const qty = Number(raw.qty);
    if (!isFinite(qty) || qty < 0) throw new Error("Unit quantity must be zero or greater.");
    if (conversionId !== "BASE" && !byId[conversionId]) {
      throw new Error("Unit conversion is not available for this product.");
    }
    entered[conversionId] = qty;
  });

  const components = [];
  catalog.forEach(function (item) {
    // BASE is always appended once below from the product's authoritative
    // base unit. Return catalogs also carry a BASE entry for the UI, so
    // processing it here would double-count the base remainder.
    if (item.conversionId === "BASE") return;
    if (entered[item.conversionId] === undefined || entered[item.conversionId] <= 0) return;
    components.push({
      conversionId: item.conversionId,
      unitName: item.unitName,
      factor: item.factor,
      qty: entered[item.conversionId],
      sellingPrice: item.sellingPrice
    });
  });
  if (entered.BASE !== undefined && entered.BASE > 0) {
    const stockSellingRaw = product && product["Stock Unit Selling Price Override"];
    const stockSellingPrice = stockSellingRaw === "" || stockSellingRaw === null || stockSellingRaw === undefined
      ? ""
      : Number(stockSellingRaw);
    components.push({
      conversionId: "BASE",
      unitName: baseUnit,
      factor: 1,
      qty: entered.BASE,
      sellingPrice: isFinite(stockSellingPrice) && stockSellingPrice >= 0 ? stockSellingPrice : ""
    });
  }

  if (!components.length) throw new Error("Quantity must be greater than zero.");
  let baseQty = 0;
  components.forEach(function (item) { baseQty += item.qty * item.factor; });
  if (!isFinite(baseQty) || baseQty <= 0) throw new Error("Quantity must be greater than zero.");

  if (claimedQty !== "" && claimedQty !== null && claimedQty !== undefined) {
    const claimed = Number(claimedQty);
    if (!isFinite(claimed) || Math.abs(claimed - baseQty) > 0.0000001) {
      throw new Error("Submitted quantity does not match the unit breakdown.");
    }
  }

  const snapshot = components.map(function (item) {
    return {
      conversionId: item.conversionId,
      unitName: item.unitName,
      factor: item.factor,
      qty: item.qty
    };
  });

  return { baseQty: baseQty, snapshot: snapshot, components: components, hasBreakdown: true };
}

function resolveConfiguredUnitPrice_(product, conversionCatalog, unitIdOrName, side) {
  const pricingSide = String(side || "").toLowerCase() === "purchase" ? "purchase" : "selling";
  const stockUnit = sanitizeInput_(product && product["Unit"]);
  const requested = sanitizeInput_(unitIdOrName);
  const catalog = conversionCatalog || [];
  let item = null;
  catalog.some(function (candidate) {
    if (String(candidate.conversionId || "") === requested ||
        String(candidate.unitName || "").toLowerCase() === requested.toLowerCase()) {
      item = candidate;
      return true;
    }
    return false;
  });

  if (!item && stockUnit && requested.toLowerCase() !== stockUnit.toLowerCase() && requested !== "BASE") {
    throw new Error(requested + ": unit is not configured for this product.");
  }

  const basePrice = Number(product && product[pricingSide === "purchase" ? "Purchase Price" : "Selling Price"]) || 0;
  if (!item || requested === "BASE" || requested.toLowerCase() === stockUnit.toLowerCase()) {
    const overrideKey = pricingSide === "purchase"
      ? "Stock Unit Purchase Price Override"
      : "Stock Unit Selling Price Override";
    const rawOverride = product && product[overrideKey];
    if (rawOverride !== "" && rawOverride !== null && rawOverride !== undefined) {
      const custom = Number(rawOverride);
      if (isFinite(custom) && custom >= 0) return { price: custom, mode: "custom" };
    }
    return { price: roundMoney_(basePrice), mode: "auto" };
  }

  const override = pricingSide === "purchase" ? item.purchasePrice : item.sellingPrice;
  if (override !== "" && override !== null && override !== undefined) {
    const custom = Number(override);
    if (isFinite(custom) && custom >= 0) return { price: custom, mode: "custom" };
  }
  return { price: roundMoney_(basePrice * Number(item.factor || 0)), mode: "auto" };
}

function computeUnitBreakdownPurchasePricing_(resolvedBreakdown, product, conversionRows) {
  const resolved = resolvedBreakdown || {};
  const snapshot = Array.isArray(resolved.snapshot) ? resolved.snapshot : [];
  if (!snapshot.length) throw new Error("Purchase unit pricing requires a unit breakdown.");

  const catalog = productUnitConversionCatalog_(product, conversionRows || [], {});
  let lineTotalRaw = 0;
  const pricingSnapshot = snapshot.map(function (component) {
    const priceInfo = resolveConfiguredUnitPrice_(
      product,
      catalog,
      component.conversionId === "BASE" ? "BASE" : component.conversionId,
      "purchase"
    );
    const unitPrice = Number(priceInfo.price) || 0;
    lineTotalRaw += (Number(component.qty) || 0) * unitPrice;
    return {
      conversionId: component.conversionId,
      unitName: component.unitName,
      factor: component.factor,
      qty: component.qty,
      unitPrice: unitPrice
    };
  });

  const lineTotal = roundMoney_(lineTotalRaw);
  const baseQty = Number(resolved.baseQty) || snapshot.reduce(function (sum, component) {
    return sum + (Number(component.qty) || 0) * (Number(component.factor) || 0);
  }, 0);
  return {
    // Internal stock-lot cost rate intentionally retains precision so the
    // exact component total can be allocated across the authoritative base
    // quantity without creating rounding drift in FIFO COGS.
    unitPrice: baseQty > 0 ? lineTotal / baseQty : 0,
    lineTotal: lineTotal,
    pricingSnapshot: pricingSnapshot
  };
}

function computeUnitBreakdownSalePricing_(plan, resolvedBreakdown) {
  const resolved = resolvedBreakdown || {};
  const components = Array.isArray(resolved.components) && resolved.components.length
    ? resolved.components
    : (resolved.snapshot || []).map(function (item) {
        return Object.assign({ sellingPrice: "" }, item);
      });
  const streams = [];
  (plan && plan.draws || []).forEach(function (draw) {
    const qty = Number(draw.take) || 0;
    if (qty > 0) streams.push({ remaining: qty, unitSellPrice: Number(draw.unitSellPrice) || 0 });
  });
  const shortfall = Number(plan && plan.shortfall) || 0;
  if (shortfall > 0) {
    streams.push({ remaining: shortfall, unitSellPrice: Number(plan && plan.fallbackSellPrice) || 0 });
  }

  let streamIndex = 0;
  function consumeBase_(qty, countRevenue) {
    let need = qty;
    let revenue = 0;
    while (need > 0.0000001) {
      let stream = streams[streamIndex];
      if (!stream) {
        const take = need;
        if (countRevenue) revenue += take * (Number(plan && plan.fallbackSellPrice) || 0);
        need = 0;
        break;
      }
      if (stream.remaining <= 0.0000001) {
        streamIndex++;
        continue;
      }
      const take = Math.min(need, stream.remaining);
      if (countRevenue) revenue += take * stream.unitSellPrice;
      stream.remaining -= take;
      need -= take;
      if (stream.remaining <= 0.0000001) streamIndex++;
    }
    return revenue;
  }

  let lineTotalRaw = 0;
  const pricingSnapshot = components.map(function (component) {
    const baseComponentQty = (Number(component.qty) || 0) * (Number(component.factor) || 0);
    const explicit =
      component.sellingPrice !== "" && component.sellingPrice !== null && component.sellingPrice !== undefined &&
      isFinite(Number(component.sellingPrice)) && Number(component.sellingPrice) >= 0;
    let componentRevenue;
    let componentUnitPrice;
    if (explicit) {
      consumeBase_(baseComponentQty, false);
      componentUnitPrice = Number(component.sellingPrice);
      componentRevenue = (Number(component.qty) || 0) * componentUnitPrice;
    } else {
      componentRevenue = consumeBase_(baseComponentQty, true);
      componentUnitPrice = (Number(component.qty) || 0) > 0
        ? roundMoney_(componentRevenue / Number(component.qty))
        : 0;
    }
    lineTotalRaw += componentRevenue;
    return {
      conversionId: component.conversionId,
      unitName: component.unitName,
      factor: component.factor,
      qty: component.qty,
      unitPrice: componentUnitPrice
    };
  });

  const lineTotal = roundMoney_(lineTotalRaw);
  const baseQty = Number(resolved.baseQty) || components.reduce(function (sum, component) {
    return sum + (Number(component.qty) || 0) * (Number(component.factor) || 0);
  }, 0);
  return {
    unitPrice: baseQty > 0 ? roundMoney_(lineTotal / baseQty) : 0,
    lineTotal: lineTotal,
    pricingSnapshot: pricingSnapshot
  };
}

export {
  normalizeProductUnitChain_,
  resolveProductUnitBreakdown_,
  computeUnitBreakdownPurchasePricing_,
  computeUnitBreakdownSalePricing_,
};
