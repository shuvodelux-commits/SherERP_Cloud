import {requireD1Binding} from './d1-binding.js';

// Fixed, reviewed master-data groups; never interpolate a user-supplied SQL identifier.
const QUERIES = Object.freeze({
  categories: 'SELECT category_id, category_name, status FROM product_categories ORDER BY row_id ASC LIMIT ?',
  units: 'SELECT unit_id, unit_name, status FROM product_units ORDER BY row_id ASC LIMIT ?',
});

function validateLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError('Catalog read limit must be an integer from 1 through 100');
  }
  return limit;
}

async function queryRows(db, sql, limit, fields) {
  const result = await db.prepare(sql).bind(validateLimit(limit)).all();
  if (result?.success !== true || !Array.isArray(result.results)) {
    throw new Error('D1 catalog read returned an invalid result');
  }
  return result.results.map(row => {
    if (!row || fields.some(field => typeof row[field] !== 'string')) {
      throw new Error('D1 catalog read returned an invalid row');
    }
    return Object.fromEntries(fields.map(field => [field, row[field]]));
  });
}

/** Internal read-only catalog interface. NOT an authenticated RPC endpoint. */
export function createCatalogReader(env) {
  const db = requireD1Binding(env);
  return Object.freeze({
    listCategories(limit=50) {return queryRows(db, QUERIES.categories, limit, ['category_id','category_name','status']);},
    listUnits(limit=50) {return queryRows(db, QUERIES.units, limit, ['unit_id','unit_name','status']);},
  });
}
