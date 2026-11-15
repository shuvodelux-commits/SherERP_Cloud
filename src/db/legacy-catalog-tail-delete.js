import {requireD1Binding} from './d1-binding.js';

// Tail-only physical delete of two reviewed, non-sensitive master groups.
// Removing a middle row would require atomic reindexing of every subsequent
// legacy_sheet_row and is intentionally NOT supported by this adapter.
const TABLES=Object.freeze({
  PRODUCT_CATEGORIES:Object.freeze({
    sql:`DELETE FROM product_categories
      WHERE legacy_sheet_row=? AND category_id=?
        AND category_name=? AND status=?
        AND legacy_sheet_row=(SELECT MAX(legacy_sheet_row) FROM product_categories)
        AND (SELECT COUNT(*) BETWEEN 1 AND 1000
               AND COUNT(legacy_sheet_row)=COUNT(*)
               AND MIN(legacy_sheet_row)=2
               AND MAX(legacy_sheet_row)=COUNT(*)+1
             FROM product_categories)
      RETURNING legacy_sheet_row`
  }),
  PRODUCT_UNITS:Object.freeze({
    sql:`DELETE FROM product_units
      WHERE legacy_sheet_row=? AND unit_id=?
        AND unit_name=? AND status=?
        AND legacy_sheet_row=(SELECT MAX(legacy_sheet_row) FROM product_units)
        AND (SELECT COUNT(*) BETWEEN 1 AND 1000
               AND COUNT(legacy_sheet_row)=COUNT(*)
               AND MIN(legacy_sheet_row)=2
               AND MAX(legacy_sheet_row)=COUNT(*)+1
             FROM product_units)
      RETURNING legacy_sheet_row`
  })
});

function validPrecondition(value){
  return value && typeof value==='object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value)===Object.prototype || Object.getPrototypeOf(value)===null) &&
    Object.keys(value).sort().join(',')==='name,sourceId,status' &&
    typeof value.sourceId==='string' && !!value.sourceId.trim() &&
    typeof value.name==='string' && !!value.name.trim() &&
    typeof value.status==='string';
}

/**
 * Internal last-row-only adapter. Unlike original GAS deleteRow_(sheet,row),
 * a stable source identity and exact previously-read values are mandatory.
 * A stale index or non-tail delete is refused rather than corrupting the
 * row-position assumptions shared by M03 read/append/update adapters.
 *
 * NOT a general deleteRow_ port, authenticated RPC, or finance writer.
 */
export function createLegacyCatalogTailDeleteAdapter(env) {
  const DB=requireD1Binding(env);
  return Object.freeze({
    async deleteLastRow_(sheetKey,rowIndex,precondition){
      const entry=typeof sheetKey==='string' && Object.hasOwn(TABLES,sheetKey)
        ? TABLES[sheetKey]:null;
      if(!entry) throw new TypeError('Unsupported legacy catalog sheet');
      if(!Number.isInteger(rowIndex) || rowIndex<2 || rowIndex>1001){
        throw new TypeError('Invalid original physical row index');
      }
      if(!validPrecondition(precondition)){
        throw new TypeError('Invalid original catalog identity precondition');
      }
      const result=await DB.prepare(entry.sql).bind(
        rowIndex,precondition.sourceId,precondition.name,precondition.status
      ).first();
      if(result===null) {
        throw new Error('Stale or non-tail original catalog row, or unsafe provenance; delete refused');
      }
      if(!result || !Number.isInteger(result.legacy_sheet_row) ||
          result.legacy_sheet_row!==rowIndex) {
        throw new Error('Invalid D1 catalog tail-delete result');
      }
    }
  });
}
