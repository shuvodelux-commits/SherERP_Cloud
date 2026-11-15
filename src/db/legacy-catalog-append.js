import {requireD1Binding} from './d1-binding.js';
import {legacyToD1Record} from './catalog-mapping.js';

// Explicitly reviewed, non-sensitive master tables only. Never interpolate
// a caller-provided table or column name into SQL.
const CATALOG=Object.freeze({
  PRODUCT_CATEGORIES:Object.freeze({
    id:'category_id',name:'category_name',sourceId:'Category ID',sourceName:'Category Name',
    sql:`INSERT INTO product_categories
      (legacy_sheet_row,category_id,category_name,status,created_at)
      SELECT COALESCE(MAX(legacy_sheet_row),1)+1, ?,?,?,?
      FROM product_categories
      HAVING COUNT(*)<1000
        AND COUNT(legacy_sheet_row)=COUNT(*)
        AND (COUNT(*)=0 OR (MIN(legacy_sheet_row)=2 AND MAX(legacy_sheet_row)=COUNT(*)+1))
      RETURNING legacy_sheet_row`
  }),
  PRODUCT_UNITS:Object.freeze({
    id:'unit_id',name:'unit_name',sourceId:'Unit ID',sourceName:'Unit Name',
    sql:`INSERT INTO product_units
      (legacy_sheet_row,unit_id,unit_name,status,created_at)
      SELECT COALESCE(MAX(legacy_sheet_row),1)+1, ?,?,?,?
      FROM product_units
      HAVING COUNT(*)<1000
        AND COUNT(legacy_sheet_row)=COUNT(*)
        AND (COUNT(*)=0 OR (MIN(legacy_sheet_row)=2 AND MAX(legacy_sheet_row)=COUNT(*)+1))
      RETURNING legacy_sheet_row`
  })
});

// The entire batch shares one SQL statement/transaction, including provenance
// checking and physical position allocation. Input values come from a bound
// JSON array; table/column names are fixed and never supplied by a caller.
const BATCH_SQL=Object.freeze({
  PRODUCT_CATEGORIES:`INSERT INTO product_categories
    (legacy_sheet_row,category_id,category_name,status,created_at)
    SELECT COALESCE(stats.max_row,1)+CAST(input.key AS INTEGER)+1,
      json_extract(input.value,'$[0]'), json_extract(input.value,'$[1]'),
      json_extract(input.value,'$[2]'), json_extract(input.value,'$[3]')
    FROM json_each(?) AS input CROSS JOIN
      (SELECT COUNT(*) AS row_count, COUNT(legacy_sheet_row) AS indexed_count,
        MIN(legacy_sheet_row) AS min_row, MAX(legacy_sheet_row) AS max_row
       FROM product_categories) AS stats
    WHERE stats.row_count+?<=1000
      AND stats.row_count=stats.indexed_count
      AND (stats.row_count=0 OR (stats.min_row=2 AND stats.max_row=stats.row_count+1))
    ORDER BY CAST(input.key AS INTEGER)
    RETURNING legacy_sheet_row`,
  PRODUCT_UNITS:`INSERT INTO product_units
    (legacy_sheet_row,unit_id,unit_name,status,created_at)
    SELECT COALESCE(stats.max_row,1)+CAST(input.key AS INTEGER)+1,
      json_extract(input.value,'$[0]'), json_extract(input.value,'$[1]'),
      json_extract(input.value,'$[2]'), json_extract(input.value,'$[3]')
    FROM json_each(?) AS input CROSS JOIN
      (SELECT COUNT(*) AS row_count, COUNT(legacy_sheet_row) AS indexed_count,
        MIN(legacy_sheet_row) AS min_row, MAX(legacy_sheet_row) AS max_row
       FROM product_units) AS stats
    WHERE stats.row_count+?<=1000
      AND stats.row_count=stats.indexed_count
      AND (stats.row_count=0 OR (stats.min_row=2 AND stats.max_row=stats.row_count+1))
    ORDER BY CAST(input.key AS INTEGER)
    RETURNING legacy_sheet_row`,
});

function getCatalog(sheetKey) {
  const catalog=typeof sheetKey==='string' && Object.hasOwn(CATALOG,sheetKey)
    ? CATALOG[sheetKey]:null;
  if(!catalog)throw new TypeError('Unsupported legacy catalog sheet');
  return catalog;
}

function prepareRow(sheetKey,rowObj,catalog) {
  if(!rowObj || typeof rowObj!=='object' || Array.isArray(rowObj) ||
      Object.hasOwn(rowObj,'_rowIndex')) {
    throw new TypeError('Invalid legacy catalog append row');
  }
  const mapped=legacyToD1Record(sheetKey,rowObj);
  if(typeof rowObj[catalog.sourceId]!=='string' || typeof rowObj[catalog.sourceName]!=='string' ||
      typeof mapped[catalog.id]!=='string' || !mapped[catalog.id].trim() ||
      typeof mapped[catalog.name]!=='string' || !mapped[catalog.name].trim()) {
    throw new TypeError('Required original catalog ID/name must be nonblank strings');
  }
  return [mapped[catalog.id], mapped[catalog.name], mapped.status??'', mapped.created_at??''];
}

/**
 * Internal source-shaped appendRow_ and appendRows_ for two reviewed masters.
 * Single-statement INSERT+RETURNING owns row allocation and provenance guards.
 * No preflight SELECT, request cache or JS-side read-modify-write gap.
 * Never expose directly to RPC; M04 authorization is not yet implemented.
 */
export function createLegacyCatalogAppendAdapter(env) {
  const DB=requireD1Binding(env);
  return Object.freeze({
    async appendRow_(sheetKey,rowObj) {
      const catalog=getCatalog(sheetKey);
      const values=prepareRow(sheetKey,rowObj,catalog);
      const result=await DB.prepare(catalog.sql).bind(...values).first();
      if(result===null) throw new RangeError('Unsafe catalog provenance or 1000-row limit; append refused');
      if(!result || !Number.isInteger(result.legacy_sheet_row) ||
          result.legacy_sheet_row<2 || result.legacy_sheet_row>1001) {
        throw new Error('Invalid D1 catalog append result');
      }
      return result.legacy_sheet_row;
    },
    async appendRows_(sheetKey,rowObjs) {
      const catalog=getCatalog(sheetKey);
      if(!Array.isArray(rowObjs))throw new TypeError('Invalid legacy catalog batch; expected array');
      if(rowObjs.length===0)return;
      if(rowObjs.length>1000)throw new RangeError('Catalog batch exceeds 1000-row limit');
      const rows=rowObjs.map(row=>prepareRow(sheetKey,row,catalog));
      const result=await DB.prepare(BATCH_SQL[sheetKey]).bind(JSON.stringify(rows),rows.length).all();
      if(result?.success!==true || !Array.isArray(result.results)) {
        throw new Error('Invalid D1 catalog batch result');
      }
      if(result.results.length!==rows.length) {
        throw new RangeError('Unsafe catalog provenance or 1000-row limit; batch refused');
      }
      const positions=result.results.map(record=>record?.legacy_sheet_row).sort((a,b)=>a-b);
      if(positions.some((pos,i)=>!Number.isInteger(pos)||pos<2||pos>1001||
          (i>0&&pos!==positions[i-1]+1))) {
        throw new Error('Invalid D1 catalog batch row result');
      }
    }
  });
}
