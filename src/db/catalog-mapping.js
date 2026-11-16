/** M02 reviewed legacy Config.gs column mappings; not a general sheet adapter. */
export const catalogTables = Object.freeze({
  SETTINGS: Object.freeze({
    table: 'settings', columns: Object.freeze({'Key':'key','Value':'value'})
  }),
  PRODUCT_CATEGORIES: Object.freeze({
    table:'product_categories',columns:Object.freeze({'Category ID':'category_id','Category Name':'category_name','Status':'status','Created At':'created_at'})
  }),
  PRODUCT_UNITS: Object.freeze({
    table:'product_units',columns:Object.freeze({'Unit ID':'unit_id','Unit Name':'unit_name','Status':'status','Created At':'created_at'})
  })
});

/** Abort if Config.gs changes; a human must review schema/migration changes. */
export function verifyCatalogMapping(inventory) {
  if (!inventory || !Array.isArray(inventory.tables)) throw new Error('Invalid source inventory');
  for (const [key, catalog] of Object.entries(catalogTables)) {
    const matches=inventory.tables.filter(x=>x.sheetKey===key);
    if (matches.length!==1) throw new Error('Missing or duplicated sheet group: '+key);
    const declared=matches[0].columns;
    const expected=Object.keys(catalog.columns);
    if (!Array.isArray(declared) || JSON.stringify(declared)!==JSON.stringify(expected)) {
      throw new Error('Legacy column mismatch for '+key);
    }
  }
  return true;
}

function normalizedText(key,value) {
  if (value===undefined || value===null) return '';
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new Error('Unsupported invalid Date: '+key);
    return value.toISOString();
  }
  if (typeof value==='string') return value;
  if (typeof value==='boolean') return value?'true':'false';
  if (typeof value==='number' && Number.isFinite(value)) return String(value);
  throw new Error('Unsupported value type: '+key);
}

/** Convert one source row, rejecting fields not present in frozen source. */
export function legacyToD1Record(sheetKey,sourceRow) {
  const catalog=catalogTables[sheetKey];
  if (!catalog || !sourceRow || typeof sourceRow!=='object' || Array.isArray(sourceRow)) throw new Error('Unknown sheet or row');
  const mapped={};
  for (const [legacy,value] of Object.entries(sourceRow)) {
    if (legacy==='_rowIndex') {
      if (!Number.isInteger(value)||value<2) throw new Error('Invalid original sheet row');
      mapped.legacy_sheet_row=value;
      continue;
    }
    if (!Object.hasOwn(catalog.columns,legacy)) throw new Error('Unexpected legacy column: '+legacy);
    mapped[catalog.columns[legacy]]=normalizedText(legacy,value);
  }
  return mapped;
}
