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

/**
 * Internal source-shaped appendRow_ slice for two reviewed catalog masters.
 * The single SQL INSERT+RETURNING is the row allocation and provenance guard.
 * No preflight SELECT, request cache or JS-side read-modify-write gap.
 * Never expose directly to RPC; M04 authorization is not yet implemented.
 */
export function createLegacyCatalogAppendAdapter(env) {
  const DB=requireD1Binding(env);
  return Object.freeze({
    async appendRow_(sheetKey,rowObj) {
      const catalog=typeof sheetKey==='string' && Object.hasOwn(CATALOG,sheetKey)
        ? CATALOG[sheetKey]:null;
      if(!catalog) throw new TypeError('Unsupported legacy catalog sheet');
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
      const result=await DB.prepare(catalog.sql).bind(
        mapped[catalog.id], mapped[catalog.name], mapped.status??'', mapped.created_at??''
      ).first();
      if(result===null) throw new RangeError('Unsafe catalog provenance or 1000-row limit; append refused');
      if(!result || !Number.isInteger(result.legacy_sheet_row) ||
          result.legacy_sheet_row<2 || result.legacy_sheet_row>1001) {
        throw new Error('Invalid D1 catalog append result');
      }
      return result.legacy_sheet_row;
    }
  });
}
