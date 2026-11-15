import {requireD1Binding} from './d1-binding.js';

// M03 nonfinancial master-only update. No caller-supplied SQL identifiers.
// A stale row index, wrong source ID or changed name/status preimage refuses
// the write *inside* one SQLite statement (not after a JS-side SELECT).
const CATALOG=Object.freeze({
  PRODUCT_CATEGORIES:Object.freeze({
    nameHeader:'Category Name',
    sql:`UPDATE product_categories
      SET category_name=CASE WHEN ?=1 THEN ? ELSE category_name END,
          status=CASE WHEN ?=1 THEN ? ELSE status END
      WHERE category_id=? AND legacy_sheet_row=?
        AND category_name=? AND status=?
        AND EXISTS(
          SELECT 1 FROM (
            SELECT COUNT(*) AS n, COUNT(legacy_sheet_row) AS indexed_count,
              MIN(legacy_sheet_row) AS first_row, MAX(legacy_sheet_row) AS last_row
            FROM product_categories
          ) AS provenance
          WHERE n BETWEEN 1 AND 1000 AND indexed_count=n
            AND first_row=2 AND last_row=n+1
        )
      RETURNING legacy_sheet_row`
  }),
  PRODUCT_UNITS:Object.freeze({
    nameHeader:'Unit Name',
    sql:`UPDATE product_units
      SET unit_name=CASE WHEN ?=1 THEN ? ELSE unit_name END,
          status=CASE WHEN ?=1 THEN ? ELSE status END
      WHERE unit_id=? AND legacy_sheet_row=?
        AND unit_name=? AND status=?
        AND EXISTS(
          SELECT 1 FROM (
            SELECT COUNT(*) AS n, COUNT(legacy_sheet_row) AS indexed_count,
              MIN(legacy_sheet_row) AS first_row, MAX(legacy_sheet_row) AS last_row
            FROM product_units
          ) AS provenance
          WHERE n BETWEEN 1 AND 1000 AND indexed_count=n
            AND first_row=2 AND last_row=n+1
        )
      RETURNING legacy_sheet_row`
  })
});

function plainObject(value){
  return value!==null && typeof value==='object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value)===Object.prototype || Object.getPrototypeOf(value)===null);
}

function validatedChange(sheetKey,rowIndex,fields,precondition){
  const catalog=typeof sheetKey==='string' && Object.hasOwn(CATALOG,sheetKey)?CATALOG[sheetKey]:null;
  if(!catalog)throw new TypeError('Unsupported legacy catalog sheet');
  if(!Number.isInteger(rowIndex)||rowIndex<2||rowIndex>1001){
    throw new TypeError('Invalid legacy physical source row index');
  }
  if(!plainObject(fields) || !Object.keys(fields).length){
    throw new TypeError('Invalid legacy catalog update fields');
  }
  const hasName=Object.hasOwn(fields,catalog.nameHeader);
  const hasStatus=Object.hasOwn(fields,'Status');
  if(Object.keys(fields).some(key=>key!==catalog.nameHeader&&key!=='Status')||
      (!hasName&&!hasStatus)){
    throw new TypeError('Unsupported legacy catalog update field');
  }
  if(hasName && (typeof fields[catalog.nameHeader]!=='string' || !fields[catalog.nameHeader].trim())){
    throw new TypeError('Required catalog display name must be a nonblank string');
  }
  if(hasStatus && !['Active','Inactive'].includes(fields.Status)){
    throw new TypeError('Invalid catalog Status');
  }
  if(!plainObject(precondition) ||
      Object.keys(precondition).sort().join(',')!=='name,sourceId,status' ||
      typeof precondition.sourceId!=='string' || !precondition.sourceId.trim() ||
      typeof precondition.name!=='string' || !precondition.name.trim() ||
      typeof precondition.status!=='string'){
    throw new TypeError('Invalid stable source ID/name/status precondition');
  }
  return {catalog,values:[
    hasName?1:0,hasName?fields[catalog.nameHeader]:'',
    hasStatus?1:0,hasStatus?fields.Status:'',
    precondition.sourceId,rowIndex,precondition.name,precondition.status
  ]};
}

/**
 * Safe internal migration slice; NOT a drop-in port of generic GAS
 * updateRowFields_. The fourth argument is mandatory to prevent applying
 * a stale physical Sheet row index to another catalog source identity.
 * No public RPC until authenticated module integration and contract review.
 */
export function createGuardedCatalogUpdateAdapter(env){
  const DB=requireD1Binding(env);
  return Object.freeze({
    async updateRowFields_(sheetKey,rowIndex,fields,precondition){
      const {catalog,values}=validatedChange(sheetKey,rowIndex,fields,precondition);
      const result=await DB.prepare(catalog.sql).bind(...values).first();
      if(!result || result.legacy_sheet_row!==rowIndex){
        throw new Error('Stale catalog row, precondition or unsafe physical provenance; update refused');
      }
    }
  });
}
