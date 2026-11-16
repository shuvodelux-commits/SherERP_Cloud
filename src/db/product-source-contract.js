// Frozen, text-preserving offline import preflight. No D1, RPC or current stock writes.
// Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2 Config.gs
// Optional, different historical feature: sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c.
export const CANONICAL_PRODUCT_HEADERS=Object.freeze([
  'Product ID','Product Name','Brand','Category','Unit','Barcode','Purchase Price',
  'Selling Price','Current Stock','Minimum Stock','Status','Created At','Updated At',
  'Is Deleted','Deleted By','Deleted At','Delete Reason','Product Type','Bundle Revision'
]);

export const SUPPLEMENTARY_PRODUCT_HEADERS=Object.freeze([
  ...CANONICAL_PRODUCT_HEADERS.slice(0,17),
  'Purchase Price Unit','Selling Price Unit','Stock Unit Purchase Price Override',
  'Stock Unit Selling Price Override','Stock View Unit','Stock Entry Unit','Minimum Stock Unit'
]);

export const SUPPLEMENTARY_CONVERSION_HEADERS=Object.freeze([
  'Conversion ID','Product ID','Unit Name','Conversion Factor','Relation Qty',
  'Relation Unit Name','Purchase Price','Selling Price','Sort Order','Status',
  'Created At','Updated At'
]);

const MAX_SOURCE_ROWS=1000;

function requireFrozenHeaders(headers,expected) {
  if(!Array.isArray(headers)||headers.length!==expected.length||
    expected.some((column,i)=>headers[i]!==column))
    throw new Error('Source profile/header mismatch; review frozen Config.gs layout');
}

function readTextRows({headers,rows},expected,idField) {
  requireFrozenHeaders(headers,expected);
  if(!Array.isArray(rows)) throw new Error('Source rows must be an array');
  if(rows.length>MAX_SOURCE_ROWS) throw new Error('Source export exceeds 1000-row preflight bound');
  const ids=new Set();
  const result=[];
  for(let index=0;index<rows.length;index++) {
    const values=rows[index];
    if(!Array.isArray(values)||values.length!==expected.length)
      throw new Error('Source row width mismatch at sheet row '+(index+2));
    if(values.some(value=>typeof value!=='string'))
      throw new Error('Source export must preserve all cells as exact text at sheet row '+(index+2));
    const record=Object.fromEntries(expected.map((header,i)=>[header,values[i]]));
    const id=record[idField];
    if(!id.trim()) throw new Error(idField+' must not be empty at sheet row '+(index+2));
    if(ids.has(id)) throw new Error('Duplicate '+idField+' in source export: '+id);
    ids.add(id);
    result.push({sourceSheetRow:index+2,sourceId:id,fields:record});
  }
  return result;
}

/**
 * Deterministic preflight for original source or explicitly reviewed older
 * feature source. The supplementary switch is NOT a staff permission check;
 * no production writer or client RPC may rely on it as an authorization gate.
 */
export function snapshotProductTextRows({headers,rows,profile='canonical',
  explicitSupplementaryReview=false}) {
  if(profile==='canonical') return readTextRows({headers,rows},CANONICAL_PRODUCT_HEADERS,'Product ID');
  if(profile!=='supplementary') throw new Error('Unknown source profile');
  if(explicitSupplementaryReview!==true)
    throw new Error('Supplementary source needs explicit human review before import');
  return readTextRows({headers,rows},SUPPLEMENTARY_PRODUCT_HEADERS,'Product ID');
}

/**
 * Optional old feature rows can only be planned against explicitly reviewed
 * original Product IDs. No merge by name/barcode and no unit-price conversion.
 * approvedProductIds is an offline provenance precondition, NOT authorization.
 */
export function snapshotConversionTextRows({headers,rows,approvedProductIds}) {
  if(!(approvedProductIds instanceof Set))
    throw new Error('Conversion rows need an explicitly reviewed/approved Product ID set');
  const entries=readTextRows({headers,rows},SUPPLEMENTARY_CONVERSION_HEADERS,'Conversion ID');
  const seenUnitNames=new Set();
  for(const entry of entries) {
    const productId=entry.fields['Product ID'];
    const unitName=entry.fields['Unit Name'];
    if(!productId.trim()||!approvedProductIds.has(productId))
      throw new Error('Conversion Product ID not in reviewed approved source: '+productId);
    if(!unitName.trim()) throw new Error('Conversion Unit Name must not be empty');
    const key=JSON.stringify([productId,unitName.trim().toLowerCase()]);
    if(seenUnitNames.has(key))
      throw new Error('Duplicate unit label within source Product ID: '+productId);
    seenUnitNames.add(key);
  }
  return entries;
}
