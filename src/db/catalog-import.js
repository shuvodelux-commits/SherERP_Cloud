import {catalogTables, legacyToD1Record, verifyCatalogMapping} from './catalog-mapping.js';

const identityFor = {SETTINGS:'key', PRODUCT_CATEGORIES:'category_id', PRODUCT_UNITS:'unit_id'};
const requiredFor = {SETTINGS:['key'],PRODUCT_CATEGORIES:['category_id','category_name'],PRODUCT_UNITS:['unit_id','unit_name']};

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
    const rows=[];
    const seenIds=new Set(),seenPositions=new Set();
    for (const source of sourceRows[key]) {
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
      rows.push(row);
    }
    tables[key]=rows;
    groups.push({sheetKey:key,table:meta.table,rows:rows.length});
  }
  return {tables,summary:{totalRows:groups.reduce((n,x)=>n+x.rows,0),groups}};
}
