import {requireD1Binding} from './d1-binding.js';

// Deliberately narrow M03 port of Database.gs#deleteRow_ for non-sensitive
// ProductSettings masters. Production RPC stays disabled until M04 auth.
const GROUPS=Object.freeze({
  PRODUCT_CATEGORIES:Object.freeze({table:'product_categories',id:'category_id',name:'category_name'}),
  PRODUCT_UNITS:Object.freeze({table:'product_units',id:'unit_id',name:'unit_name'})
});

// All SQL identifiers come from literal module constants; caller supplies only
// bound values. Three D1 statements run atomically through D1Database.batch.
//
// Row 1 is the header; valid physical source rows are 2..1001. During the
// transaction only, add 1002 to following rows, putting them above 1002;
// then subtract 1003 to shift down by one without violating SQLite UNIQUE.
// changes() gates each phase to the previous completed SQL statement.
const SQL=Object.freeze(Object.fromEntries(Object.entries(GROUPS).map(([key,{table,id,name}])=>[
  key,Object.freeze({
    delete:`DELETE FROM ${table}
      WHERE legacy_sheet_row=? AND ${id}=? AND ${name}=? AND status=?
      AND EXISTS (
        SELECT 1 FROM (
          SELECT COUNT(*) AS n, COUNT(legacy_sheet_row) AS indexed,
                 MIN(legacy_sheet_row) AS first_row, MAX(legacy_sheet_row) AS last_row
          FROM ${table}
        ) AS provenance
        WHERE n BETWEEN 1 AND 1000 AND indexed=n
          AND first_row=2 AND last_row=n+1
      )
      RETURNING legacy_sheet_row`,
    stage:`UPDATE ${table}
      SET legacy_sheet_row=legacy_sheet_row+1002
      WHERE legacy_sheet_row>? AND changes()=1`,
    compact:`UPDATE ${table}
      SET legacy_sheet_row=legacy_sheet_row-1003
      WHERE legacy_sheet_row>1002 AND changes()>0`
  })
])));

function exactPreimage(value) {
  if(!value || typeof value!=='object' || Array.isArray(value) ||
     (Object.getPrototypeOf(value)!==Object.prototype && Object.getPrototypeOf(value)!==null) ||
     Object.keys(value).sort().join(',')!=='name,sourceId,status' ||
     typeof value.sourceId!=='string' || !value.sourceId.trim() ||
     typeof value.name!=='string' || !value.name.trim() ||
     typeof value.status!=='string' || !value.status) {
    throw new TypeError('Invalid catalog deletion precondition');
  }
  return value;
}

/**
 * Internal, privileged-only repository primitive. NOT a general D1/Sheet
 * writer and NEVER expose directly to untrusted RPC without M04 products.edit.
 */
export function createGuardedCatalogDeleteAdapter(env) {
  const DB=requireD1Binding(env);
  if(typeof DB.batch!=='function') throw new Error('D1 transactional batch binding unavailable');
  return Object.freeze({
    async deleteRow_(sheetKey,rowIndex,preimage) {
      const group=typeof sheetKey==='string'&&Object.hasOwn(SQL,sheetKey)?SQL[sheetKey]:null;
      if(!group) throw new TypeError('Unsupported legacy catalog sheet');
      if(!Number.isInteger(rowIndex)||rowIndex<2||rowIndex>1001) {
        throw new TypeError('Invalid original physical catalog row index');
      }
      const {sourceId,name,status}=exactPreimage(preimage);
      const outcome=await DB.batch([
        DB.prepare(group.delete).bind(rowIndex,sourceId,name,status),
        DB.prepare(group.stage).bind(rowIndex),
        DB.prepare(group.compact)
      ]);
      if(!Array.isArray(outcome)||outcome.length!==3 ||
         outcome.some(part=>part?.success!==true)) {
        throw new Error('Invalid D1 catalog delete transaction result; reconcile by source ID');
      }
      if(outcome[0].results?.length!==1 ||
         outcome[0].results[0]?.legacy_sheet_row!==rowIndex) {
        throw new Error('Stale or unsafe catalog deletion refused');
      }
      // Successful deletion returns void, matching legacy Database.gs.
    }
  });
}
