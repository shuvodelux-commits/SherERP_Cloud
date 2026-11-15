/**
 * M06 read-only adapter: four exactly source-copied Bundle recipe helpers.
 * Frozen Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2,
 * legacy/source/Bundles.gs. No GAS, D1, auth, RPC or stock mutation.
 * Original function bodies are asserted byte-for-byte in test oracle.
 */

function bundleProductType_(row) {
  return String(row && row['Product Type'] || '').trim() === 'Bundle' ? 'Bundle' : 'Standard';
}

function validateBundleDefinition_(bundleId, components, productsById) {
  if (!Array.isArray(components) || !components.length) throw new Error('Bundle needs at least one component.');
  const seen = {};
  return components.map(function (component) {
    const id = String(component && (component.productId || component['Component Product ID']) || '').trim();
    const qty = Number(component && (component.qtyPerSet === undefined ? component['Quantity Per Set'] : component.qtyPerSet));
    const product = productsById[id];
    if (!id || !product) throw new Error('Bundle component product was not found.');
    if (id === String(bundleId) || bundleProductType_(product) !== 'Standard') {
      throw new Error('A bundle can contain only a standard product.');
    }
    if (String(product.Status || '').toLowerCase() !== 'active' ||
        String(product['Is Deleted'] || '').toUpperCase() === 'TRUE') {
      throw new Error('Bundle component must be active: ' + id);
    }
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('Bundle component quantity must be finite and greater than zero.');
    if (qty > 1000000000) throw new Error('Bundle component quantity exceeds maximum allowed.');
    if (seen[id]) throw new Error('A component appears more than once; combine quantities.');
    seen[id] = true;
    return {productId: id, qtyPerSet: qty, unit: String(product.Unit || component.unit || 'pcs')};
  });
}

function getBundleDefinitions_(bundleIds, productsById, componentRows) {
  const required = {}, definitions = {};
  (bundleIds || []).forEach(function (id) { required[String(id)] = true; });
  (componentRows || []).forEach(function (row) {
    const id = String(row['Bundle Product ID'] || '');
    const product = productsById[id];
    if (!required[id] || !product || bundleProductType_(product) !== 'Bundle') return;
    const revision = Number(product['Bundle Revision']) || 1;
    if (Number(row.Revision) !== revision || String(row.Status || '').toLowerCase() !== 'active') return;
    if (!definitions[id]) definitions[id] = {bundleId: id, revision: revision, components: []};
    definitions[id].components.push({
      productId: String(row['Component Product ID'] || ''),
      qtyPerSet: Number(row['Quantity Per Set']), unit: String(row.Unit || '')
    });
  });
  Object.keys(required).forEach(function (id) {
    if (!productsById[id] || bundleProductType_(productsById[id]) !== 'Bundle') throw new Error('Bundle product not found: ' + id);
    if (!definitions[id] || !definitions[id].components.length) throw new Error('Bundle recipe unavailable: ' + id);
    definitions[id].components = validateBundleDefinition_(id, definitions[id].components, productsById);
  });
  return definitions;
}

function getBundleAvailability_(definition, productsById) {
  if (!definition || !definition.components || !definition.components.length) return 0;
  return Math.max(0, Math.min.apply(null, definition.components.map(function (c) {
    const stock = Number(productsById[c.productId] && productsById[c.productId]['Current Stock']) || 0;
    return Math.floor(Math.max(0, stock) / c.qtyPerSet);
  })));
}

export { bundleProductType_, validateBundleDefinition_, getBundleDefinitions_, getBundleAvailability_ };
