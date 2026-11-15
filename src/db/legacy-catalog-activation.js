import {requireD1Binding} from './d1-binding.js';

// Internal, fixed-identifiers-only M03 slice of legacy updateRowFields_.
// The source ProductSettings.gs uses Status='Active' on reactivation; inactive
// status requests delete the row and are NOT implemented by this adapter.
const CATALOGS=Object.freeze({
  PRODUCT_CATEGORIES:Object.freeze({
    sql:`UPDATE product_categories
      SET status = 'Active'
      WHERE legacy_sheet_row=? AND category_id=? AND status=?
        AND (SELECT COUNT(*) BETWEEN 1 AND 1000
               AND COUNT(legacy_sheet_row)=COUNT(*)
               AND MIN(legacy_sheet_row)=2
               AND MAX(legacy_sheet_row)=COUNT(*)+1
             FROM product_categories)
      RETURNING legacy_sheet_row`
  }),
  PRODUCT_UNITS:Object.freeze({
    sql:`UPDATE product_units
      SET status = 'Active'
      WHERE legacy_sheet_row=? AND unit_id=? AND status=?
        AND (SELECT COUNT(*) BETWEEN 1 AND 1000
               AND COUNT(legacy_sheet_row)=COUNT(*)
               AND MIN(legacy_sheet_row)=2
               AND MAX(legacy_sheet_row)=COUNT(*)+1
             FROM product_units)
      RETURNING legacy_sheet_row`
  })
});

/**
 * Guarded single-row transition to 'Active', not a general Sheet writer.
 * expectedSourceId and expectedStatus are required compare-and-swap guards:
 * physical Sheet row positions can shift after legacy deletions.
 * No stale JS read/preflight may authorize a write.
 */
export function createLegacyCatalogActivationAdapter(env) {
  const DB=requireD1Binding(env);
  return Object.freeze({
    async activate_(sheetKey,rowIndex,expectedSourceId,expectedStatus) {
      const catalog=typeof sheetKey==='string'&&Object.hasOwn(CATALOGS,sheetKey)
        ? CATALOGS[sheetKey]:null;
      if(!catalog) throw new TypeError('Unsupported legacy catalog sheet');
      if(!Number.isInteger(rowIndex)||rowIndex<2||rowIndex>1001) {
        throw new TypeError('Invalid original physical row index');
      }
      if(typeof expectedSourceId!=='string'||!expectedSourceId.trim()||
         typeof expectedStatus!=='string'||!expectedStatus) {
        throw new TypeError('Invalid expected catalog ID/status');
      }
      const result=await DB.prepare(catalog.sql).bind(rowIndex,expectedSourceId,expectedStatus).first();
      if(result===null) {
        throw new Error('Unsafe or stale legacy catalog activation refused');
      }
      if(!result||!Number.isInteger(result.legacy_sheet_row)||
         result.legacy_sheet_row!==rowIndex) {
        throw new Error('Invalid D1 catalog activation result');
      }
      return result.legacy_sheet_row;
    }
  });
}
