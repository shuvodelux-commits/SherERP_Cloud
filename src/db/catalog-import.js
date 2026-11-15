import {catalogTables, legacyToD1Record, verifyCatalogMapping} from './catalog-mapping.js';

const identityFor = {SETTINGS:'key', PRODUCT_CATEGORIES:'category_id', PRODUCT_UNITS:'unit_id'};
const requiredFor = {SETTINGS:['key'],PRODUCT_CATEGORIES:['category_id','category_name'],PRODUCT_UNITS:['unit_id','unit_name']};
const M03_SOURCE_POSITIONED_CATALOGS=new Set(['PRODUCT_CATEGORIES','PRODUCT_UNITS']);
const MAX_M03_CATALOG_ROWS=1000;

/** Validate and normalize a synthetic/authorized export without writing any database. */
export function prepareCatalogImport(inventory,sourceRows) {
  verifyCatalogMapping(inventory);
  if (!sourceRows || typeof sourceRows!=='object' || Array.isArray(sourceRows)) throw new Error('Invalid export object');
  for (const key of Object.keys(sourceRows)) {
    if (!Object.hasOwn(catalogTables,key)) throw new Error('Unknown source group: '+key);
  }
  const tables={};
  const groups=[];
  for (const [key,meta] of Object.entries(catalogTables)) {
    if (!Object.hasOwn(sourceRows,key) || !Array.isArray(sourceRows[key])) throw new Error('Missing source group: '+key);
    const sourcePositioned=M03_SOURCE_POSITIONED_CATALOGS.has(key);
    if (sourcePositioned && sourceRows[key].length>MAX_M03_CATALOG_ROWS) {
      throw new RangeError('M03 catalog exceeds 1000-row bounded read limit: '+key);
    }
    const rows=[];
    const seenIds=new Set(),seenPositions=new Set();
    for (const [index,source] of sourceRows[key].entries()) {
      const row=legacyToD1Record(key,source);
      for (const required of requiredFor[key]) {
        if (typeof row[required]!=='string' || !row[required].trim()) throw new Error('Required field empty: '+key+'.'+required);
      }
      const idField=identityFor[key];
      if (seenIds.has(row[idField])) throw new Error('Duplicate '+idField+' in '+key);
      seenIds.add(row[idField]);
      if (Object.hasOwn(row,'legacy_sheet_row')) {
        if (seenPositions.has(row.legacy_sheet_row)) throw new Error('Duplicate legacy_sheet_row in '+key);
        seenPositions.add(row.legacy_sheet_row);
      }
      // M03 reader mirrors the original physical Sheet order; never invent positions.
      if (sourcePositioned && row.legacy_sheet_row!==index+2) {
        throw new Error('Invalid original physical source row order in '+key);
      }
      rows.push(row);
    }
    tables[key]=rows;
    groups.push({sheetKey:key,table:meta.table,rows:rows.length});
  }
  return {tables,summary:{totalRows:groups.reduce((n,x)=>n+x.rows,0),groups}};
}
