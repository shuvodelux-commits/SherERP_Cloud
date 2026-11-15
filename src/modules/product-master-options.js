import {createLegacyCatalogReadAdapter} from '../db/legacy-catalog-read.js';

/**
 * Internal, read-only M03 slice of Products.gs#getProductsBootstrap.
 * It intentionally excludes products, stock valuation, SETTINGS and public RPC.
 * Original source excludes only exact Status === 'Inactive'.
 */
export function createProductMasterOptionsReader(env) {
  const catalog=createLegacyCatalogReadAdapter(env);
  return Object.freeze({
    async getOptions() {
      const [categories,units]=await Promise.all([
        catalog.getAllRows_('PRODUCT_CATEGORIES'),
        catalog.getAllRows_('PRODUCT_UNITS'),
      ]);
      return {
        categories:categories
          .filter(row=>row.Status!=='Inactive')
          .map(row=>({id:row['Category ID'],name:row['Category Name']})),
        units:units
          .filter(row=>row.Status!=='Inactive')
          .map(row=>({id:row['Unit ID'],name:row['Unit Name']})),
      };
    },
  });
}
