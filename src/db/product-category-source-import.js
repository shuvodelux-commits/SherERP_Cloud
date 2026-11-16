import {legacyToD1Record} from './catalog-mapping.js';
import {createLegacyCatalogReadAdapter} from './legacy-catalog-read.js';

// Frozen PRODUCT_CATEGORIES Config.gs source, not a generic Sheet importer.
// All D1 SQL identifiers are fixed; this module has no public Worker/RPC route.
const SOURCE_FIELDS=Object.freeze([
  'Category ID','Category Name','Status','Created At','_rowIndex'
]);
const SQL_INSERT=`INSERT INTO product_categories
  (legacy_sheet_row,category_id,category_name,status,created_at)
  VALUES (?,?,?,?,?)`;

// Execute this statement FIRST in the SAME D1.batch transaction as all rows.
// On an already-populated category table, the existing NOT NULL constraint
// raises and aborts the batch. A separate JS read-before-write is not atomic.
const SQL_REQUIRE_EMPTY=`INSERT INTO product_categories
  (category_id,category_name,status)
  SELECT NULL,NULL,NULL WHERE EXISTS (SELECT 1 FROM product_categories)`;

function isExactSourceDataRow(value) {
  if(value===null || typeof value!=='object' || Array.isArray(value) ||
     ![Object.prototype,null].includes(Object.getPrototypeOf(value)))
    return false;
  const keys=Reflect.ownKeys(value);
  if(keys.length!==SOURCE_FIELDS.length ||
     keys.some(key=>typeof key!=='string'||!SOURCE_FIELDS.includes(key)))
    return false;
  return SOURCE_FIELDS.every(key=>{
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    return descriptor?.enumerable===true&&Object.hasOwn(descriptor,'value');
  });
}

/** Read-only whole-snapshot validation; no D1 operations or source mutation. */
export function prepareSourceProductCategories(sourceRows) {
  if(!Array.isArray(sourceRows) ||
     sourceRows.length<1 || sourceRows.length>1000)
    throw new Error('Invalid source Product Categories import row count');
  const seenIds=new Set();
  return sourceRows.map((row,index)=>{
    if(!isExactSourceDataRow(row))
      throw new Error('Invalid source Product Categories row fields');
    if(row._rowIndex!==index+2)
      throw new Error('Invalid source Product Categories physical row order');
    if(typeof row['Category ID']!=='string'||!row['Category ID'].trim()||
       typeof row['Category Name']!=='string'||!row['Category Name'].trim())
      throw new Error('Invalid source Product Categories ID or display name');
    if(!['Active','Inactive',''].includes(row.Status))
      throw new Error('Invalid source Product Categories status');
    if(typeof row['Created At']!=='string' && !(row['Created At'] instanceof Date))
      throw new Error('Invalid source Product Categories created date');
    if(seenIds.has(row['Category ID']))
      throw new Error('Duplicate source Product Categories ID');
    seenIds.add(row['Category ID']);
    let record;
    try {
      record=legacyToD1Record('PRODUCT_CATEGORIES',row);
    }catch {
      throw new Error('Invalid source Product Categories field value');
    }
    // Original source permits duplicate labels under different stable IDs.
    return {
      legacy_sheet_row:record.legacy_sheet_row,
      category_id:record.category_id,
      category_name:record.category_name,
      status:record.status,
      created_at:record.created_at
    };
  });
}

/**
 * Internal, one-shot offline Product Categories snapshot import.
 * This is NOT an authorized public import or an M10 migration cutover.
 */
export async function importSourceProductCategoriesWithD1({DB,sourceRows}={}) {
  const rows=prepareSourceProductCategories(sourceRows);
  if(!DB || typeof DB.prepare!=='function'||typeof DB.batch!=='function')
    throw new Error('D1 Product Categories import binding unavailable');
  try {
    await DB.batch([
      DB.prepare(SQL_REQUIRE_EMPTY),
      ...rows.map(row=>DB.prepare(SQL_INSERT).bind(
        row.legacy_sheet_row,row.category_id,row.category_name,row.status,row.created_at
      ))
    ]);
  }catch {
    // Preserve privacy of original labels/IDs and SQL internals in failures.
    throw new Error('D1 Product Categories import failed; target must be fresh');
  }

  let actual;
  try {
    actual=await createLegacyCatalogReadAdapter({DB}).getAllRows_('PRODUCT_CATEGORIES');
  }catch {
    // This read happens AFTER the batch. It cannot undo committed writes.
    throw new Error('NEEDS_REVIEW: Product Categories readback unavailable after import');
  }
  const expected=rows.map(row=>({
    'Category ID':row.category_id,
    'Category Name':row.category_name,
    Status:row.status,
    'Created At':row.created_at,
    _rowIndex:row.legacy_sheet_row
  }));
  if(JSON.stringify(actual)!==JSON.stringify(expected))
    throw new Error('NEEDS_REVIEW: Product Categories readback differs from imported source');
  return {sourceGroup:'PRODUCT_CATEGORIES',importedRows:rows.length,reconciled:true};
}
