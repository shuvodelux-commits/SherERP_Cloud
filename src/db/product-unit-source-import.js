import {legacyToD1Record} from './catalog-mapping.js';
import {createLegacyCatalogReadAdapter} from './legacy-catalog-read.js';

// PRODUCT_UNITS from frozen source Config.gs: no dynamic table names and no
// production/preview RPC. This is an offline source snapshot *rehearsal*.
const KEYS=Object.freeze(['Unit ID','Unit Name','Status','Created At','_rowIndex']);
const INSERT=`INSERT INTO product_units
  (legacy_sheet_row,unit_id,unit_name,status,created_at)
  VALUES (?,?,?,?,?)`;

// Must be the first statement inside D1.batch. When the target is nonempty,
// deliberately violate the existing NOT NULL constraint so the *whole batch*
// aborts atomically; a JS-only SELECT followed by writes is not safe.
const ASSERT_EMPTY=`INSERT INTO product_units (unit_id,unit_name,status)
  SELECT NULL,NULL,NULL WHERE EXISTS (SELECT 1 FROM product_units)`;

function ownDataRow(row) {
  if(row===null || typeof row!=='object' || Array.isArray(row) ||
     ![Object.prototype,null].includes(Object.getPrototypeOf(row)))return false;
  const keys=Reflect.ownKeys(row);
  if(keys.length!==KEYS.length || keys.some(k=>typeof k!=='string'||!KEYS.includes(k)))return false;
  return KEYS.every(key=>{
    const descriptor=Object.getOwnPropertyDescriptor(row,key);
    return descriptor?.enumerable===true && Object.hasOwn(descriptor,'value');
  });
}

/** Pure validation: no D1 I/O, source mutation, auto-generated IDs or row guessing. */
export function prepareSourceProductUnits(sourceRows) {
  if(!Array.isArray(sourceRows) || sourceRows.length<1 || sourceRows.length>1000)
    throw new Error('Invalid source Product Units import row count');
  const seen=new Set();
  return sourceRows.map((row,i)=>{
    if(!ownDataRow(row))throw new Error('Invalid source Product Units row fields');
    if(row._rowIndex!==i+2)
      throw new Error('Invalid source Product Units physical row order');
    if(typeof row['Unit ID']!=='string' || !row['Unit ID'].trim() ||
       typeof row['Unit Name']!=='string' || !row['Unit Name'].trim())
      throw new Error('Invalid source Product Units ID or display name');
    if(!['Active','Inactive',''].includes(row.Status))
      throw new Error('Invalid source Product Units status');
    const createdAt=row['Created At'];
    if(typeof createdAt!=='string' && !(createdAt instanceof Date))
      throw new Error('Invalid source Product Units created date');
    if(seen.has(row['Unit ID']))throw new Error('Duplicate source Product Units ID');
    seen.add(row['Unit ID']);
    let record;
    try{
      record=legacyToD1Record('PRODUCT_UNITS',row);
    }catch{
      throw new Error('Invalid source Product Units field value');
    }
    return {
      legacy_sheet_row:record.legacy_sheet_row,
      unit_id:record.unit_id,unit_name:record.unit_name,
      status:record.status,created_at:record.created_at
    };
  });
}

/**
 * Internal one-shot local D1 import of a complete, operator-provided Product
 * Units snapshot. SQL-level guard and rows are in one D1 batch transaction.
 *
 * Before invoking with real data, separate source export/cutover approval is
 * required. This function alone provides no operator authentication.
 */
export async function importSourceProductUnitsWithD1({DB,sourceRows}={}) {
  const rows=prepareSourceProductUnits(sourceRows);
  if(!DB || typeof DB.prepare!=='function' || typeof DB.batch!=='function')
    throw new Error('D1 Product Units import binding unavailable');
  try{
    await DB.batch([
      DB.prepare(ASSERT_EMPTY),
      ...rows.map(row=>DB.prepare(INSERT).bind(
        row.legacy_sheet_row,row.unit_id,row.unit_name,row.status,row.created_at
      ))
    ]);
  }catch{
    // Source IDs/labels, private SQL errors and D1 connection details must
    // never be echoed into PR/CI or public error bodies.
    throw new Error('D1 Product Units import failed; target must be fresh');
  }
  let actual;
  try{
    actual=await createLegacyCatalogReadAdapter({DB}).getAllRows_('PRODUCT_UNITS');
  }catch{
    // The SQL transaction may already have committed. Do not misreport
    // this as a rollback or automatically retry a potentially committed write.
    throw new Error('NEEDS_REVIEW: Product Units readback unavailable after import');
  }
  const expected=rows.map(row=>({
    'Unit ID':row.unit_id,'Unit Name':row.unit_name,
    Status:row.status,'Created At':row.created_at,
    _rowIndex:row.legacy_sheet_row
  }));
  if(JSON.stringify(actual)!==JSON.stringify(expected))
    throw new Error('NEEDS_REVIEW: Product Units readback differs from imported source');
  return {sourceGroup:'PRODUCT_UNITS',importedRows:rows.length,reconciled:true};
}
