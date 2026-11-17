/**
 * M05 INTERNAL virtual Bundle source-parity adapter (read-only).
 * Frozen source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * Functions below copied byte-for-byte from legacy/source/Bundles.gs.
 * No D1/Worker binding, FIFO reservation, stock mutation or public RPC.
 */
function bundleProductType_(row) {
  return String(row && row['Product Type'] || '').trim() === 'Bundle' ? 'Bundle' : 'Standard';
}
function bundleProductMap_(rows) {
  const out = {};
  (rows || []).forEach(function (row) { out[row['Product ID']] = row; });
  return out;
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


/**
 * Source-faithful, current-only virtual Bundle availability snapshot.
 * Strict input guard is new M05 logic; helper declarations above are copied
 * from frozen original Bundles.gs without changes.
 *
 * No stock write, lot issue, checkout, RPC, price authorization or tenant
 * authentication. M03/M04/M06 must use atomic stock/permission validation
 * before any sale, and M07 owns historical recipe return/reversal semantics.
 */
const safeIdentity=(id,label)=>{
 if(typeof id!=='string'||!id||id!==id.trim()||id.length>256||
    /[\u0000-\u001f\u007f]/u.test(id)||id in Object.prototype)
   throw new TypeError('Invalid or reserved original '+label+' identity');
 return id;
};

function plainRecord(value,label){
 if(value===null||typeof value!=='object'||Array.isArray(value)||
   ![Object.prototype,null].includes(Object.getPrototypeOf(value)))
   throw new TypeError('Invalid trusted '+label+' record');
 for(const k of Reflect.ownKeys(value)){
   const prop=Object.getOwnPropertyDescriptor(value,k);
   if(typeof k!=='string'||!prop.enumerable||!Object.hasOwn(prop,'value'))
     throw new TypeError('Invalid trusted '+label+' field or accessor');
 }
 return value;
}

function trustedRows(value,label){
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||
    value.length===0||value.length>10000)
   throw new TypeError('Invalid '+label+' source snapshot array');
 const desc=Object.getOwnPropertyDescriptors(value);
 for(const key of Reflect.ownKeys(desc)){
   if(key==='length')continue;
   if(typeof key!=='string'||!/^(?:0|[1-9][0-9]*)$/u.test(key)||
      Number(key)>=value.length||!Object.hasOwn(desc[key],'value'))
     throw new TypeError('Invalid '+label+' array or accessor');
 }
 for(let i=0;i<value.length;i++){
   if(!Object.hasOwn(desc,String(i)))
     throw new TypeError('Sparse '+label+' array');
   plainRecord(value[i],label+' row');
 }
 return value;
}

const finiteStock=value=>typeof value==='number'&&Number.isFinite(value)&&
  Math.abs(value)<=Number.MAX_SAFE_INTEGER;

export function reviewBundleStockAvailability(input){
 const s=plainRecord(input,'Bundle availability input');
 const required=['bundleId','products','componentRows'];
 if(Reflect.ownKeys(s).length!==required.length||
    required.some(k=>!Object.hasOwn(s,k)))
   throw new TypeError('Explicit Bundle ID, products and component source snapshots required');

 const bundleId=safeIdentity(s.bundleId,'Bundle Product ID');
 const products=trustedRows(s.products,'product');
 const recipe=trustedRows(s.componentRows,'component');

 const productsById=Object.create(null);
 for(const product of products){
   const productId=safeIdentity(product['Product ID'],'Product ID');
   if(Object.hasOwn(productsById,productId))
     throw new TypeError('Duplicate original product ID: '+productId);
   // Bundle source data is a trusted snapshot, never a browser price or
   // authoritative live stock. Reject invalid values instead of coercion.
   if(!finiteStock(product['Current Stock']))
     throw new TypeError('Invalid finite product Current Stock');
   productsById[productId]=product;
 }
 const bundle=productsById[bundleId];
 if(!bundle)throw new Error('Bundle product not found: '+bundleId);
 if(bundleProductType_(bundle)!=='Bundle')
   throw new Error('Bundle product not found: '+bundleId);
 if(String(bundle.Status||'').trim().toLowerCase()!=='active'||
    String(bundle['Is Deleted']||'').trim().toUpperCase()==='TRUE')
   throw new Error('Bundle product must be active: '+bundleId);
 const revision=bundle['Bundle Revision'];
 if(!Number.isSafeInteger(revision)||revision<=0)
   throw new TypeError('Invalid current Bundle Revision integer');
 const sellingPrice=bundle['Selling Price'];
 if(typeof sellingPrice!=='number'||!Number.isFinite(sellingPrice)||
    sellingPrice<0)
   throw new TypeError('Invalid finite Bundle selling price');
 if(bundle['Current Stock']!==0)
   throw new Error('NEEDS_REVIEW: virtual Bundle cannot retain physical Current Stock');

 // Validate source rows before the frozen helper reads Product IDs or
 // selects only the active current recipe revision.
 for(const row of recipe){
   const id=safeIdentity(row['Bundle Product ID'],'recipe Bundle Product ID');
   const component=safeIdentity(row['Component Product ID'],'component Product ID');
   if(id===bundleId && component===bundleId)
     throw new Error('A bundle can contain only a standard product.');
 }

 const definition=getBundleDefinitions_([bundleId],productsById,recipe)[bundleId];
 if(!definition||definition.revision!==revision)
   throw new Error('Bundle current recipe revision unavailable: '+bundleId);
 const availableSets=getBundleAvailability_(definition,productsById);
 if(!Number.isSafeInteger(availableSets)||availableSets<0)
   throw new Error('NEEDS_REVIEW: unsafe virtual Bundle availability');

 const components=definition.components.map(c=>{
   const stock=productsById[c.productId]['Current Stock'];
   const setsSupported=Math.floor(Math.max(0,stock)/c.qtyPerSet);
   if(!Number.isSafeInteger(setsSupported)||setsSupported<0)
     throw new Error('NEEDS_REVIEW: unsafe component availability');
   return {productId:c.productId,qtyPerSet:c.qtyPerSet,unit:c.unit,
     currentStock:stock,setsSupported};
 });
 return {
   mode:'read-only-bundle-availability',bundleId,revision,
   bundleSellingPrice:sellingPrice,availableSets,components,
   stockAuthority:'snapshot-only',bundlePhysicalStock:false,
   postingAllowed:false
 };
}
