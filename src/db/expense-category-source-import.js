import {mapExpenseCategoryRecord} from './expense-category-mapping.js';

// EXPENSE_CATEGORIES only; no generic Sheets adapter, Worker route or remote data access.
const FIELDS=Object.freeze([
  'Category ID','Category Name','Description','Status','Created At','_rowIndex'
]);
const SQL_INSERT='INSERT INTO expense_categories (legacy_sheet_row,category_id,category_name,description,status,created_at) VALUES (?,?,?,?,?,?)';
// Execute in the same D1 batch as inserts: NOT NULL aborts the WHOLE
// transaction when the target contains any existing rows.
const SQL_REQUIRE_EMPTY='INSERT INTO expense_categories (category_id,category_name) SELECT NULL,NULL WHERE EXISTS (SELECT 1 FROM expense_categories)';
const SQL_READ='SELECT legacy_sheet_row,category_id,category_name,description,status,created_at FROM expense_categories ORDER BY legacy_sheet_row ASC LIMIT ?';

function isExactRow(row) {
  if(!row||typeof row!=='object'||Array.isArray(row)||
     Object.getPrototypeOf(row)!==Object.prototype) return false;
  const keys=Reflect.ownKeys(row);
  if(keys.length!==FIELDS.length||
     keys.some(key=>typeof key!=='string'||!FIELDS.includes(key))) return false;
  return FIELDS.every(key=>{
    const descriptor=Object.getOwnPropertyDescriptor(row,key);
    return descriptor?.enumerable===true && Object.hasOwn(descriptor,'value');
  });
}

/** Complete offline snapshot preflight. No SQL, no source mutation. */
export function prepareSourceExpenseCategories(sourceRows) {
  if(!Array.isArray(sourceRows)||sourceRows.length<1||sourceRows.length>1000)
    throw new Error('Invalid source Expense Categories row count');
  const ids=new Set();
  return sourceRows.map((row,index)=>{
    if(!isExactRow(row))throw new Error('Invalid source Expense Categories row fields');
    if(row._rowIndex!==index+2)
      throw new Error('Invalid source Expense Categories physical row order');
    if(typeof row['Category ID']!=='string'||!row['Category ID'].trim()||
       typeof row['Category Name']!=='string'||!row['Category Name'].trim())
      throw new Error('Invalid source Expense Categories ID/name');
    if(typeof row.Description!=='string' ||
       !['Active','Inactive',''].includes(row.Status))
      throw new Error('Invalid source Expense Categories description/status');
    if(typeof row['Created At']!=='string'&&!(row['Created At'] instanceof Date))
      throw new Error('Invalid source Expense Categories timestamp');
    if(ids.has(row['Category ID']))
      throw new Error('Duplicate source Expense Categories ID');
    ids.add(row['Category ID']);
    let record;
    try {record=mapExpenseCategoryRecord(row);}
    catch {throw new Error('Invalid source Expense Categories value');}
    return {
      legacy_sheet_row:record.legacy_sheet_row,
      category_id:record.category_id,
      category_name:record.category_name,
      description:record.description,
      status:record.status,
      created_at:record.created_at
    };
  });
}

/**
 * Internal one-shot import of a full offline source snapshot.
 * A postcommit readback mismatch cannot undo the D1 batch: NEEDS_REVIEW.
 * This is neither public authorization nor production data reconciliation.
 */
export async function importSourceExpenseCategoriesWithD1({DB,sourceRows}={}) {
  const rows=prepareSourceExpenseCategories(sourceRows);
  if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')
    throw new Error('D1 Expense Categories binding unavailable');

  try {
    const results=await DB.batch([
      DB.prepare(SQL_REQUIRE_EMPTY),
      ...rows.map(row=>DB.prepare(SQL_INSERT).bind(
        row.legacy_sheet_row,row.category_id,row.category_name,
        row.description,row.status,row.created_at
      ))
    ]);
    if(!Array.isArray(results)||results.length!==rows.length+1||
       results.some(result=>result?.success!==true))
      throw new Error('Invalid D1 batch result');
  }catch {
    throw new Error('D1 Expense Categories import failed; target must be fresh');
  }

  let actual;
  try {
    const response=await DB.prepare(SQL_READ).bind(1001).all();
    if(response?.success!==true||!Array.isArray(response.results))
      throw new Error('Readback unavailable');
    actual=response.results;
  }catch {
    throw new Error('NEEDS_REVIEW: Expense Categories D1 readback unavailable after commit');
  }
  const columns=['legacy_sheet_row','category_id','category_name','description','status','created_at'];
  if(actual.length!==rows.length || actual.some((record,index)=>
    !record||Object.keys(record).length!==columns.length||
    columns.some(key=>record[key]!==rows[index][key])
  ))throw new Error('NEEDS_REVIEW: Expense Categories D1 readback differs after commit');

  return {sourceGroup:'EXPENSE_CATEGORIES',importedRows:rows.length,reconciled:true};
}
