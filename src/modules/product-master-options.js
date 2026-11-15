import {createLegacyCatalogReadAdapter} from '../db/legacy-catalog-read.js';
import {createSettingsReadAdapter} from '../db/settings-read.js';

/**
 * Internal, read-only M03 slice of Products.gs#getProductsBootstrap.
 * Product/stock/lot/bundle data and public RPC remain out of scope.
 * Source excludes only exact Status === 'Inactive' and uses the Settings
 * Currency Symbol / Low Stock Threshold fields without rewriting defaults.
 */
export function createProductMasterOptionsReader(env) {
  const catalog=createLegacyCatalogReadAdapter(env);
  const settings=createSettingsReadAdapter(env);
  const getOptions=async()=>{
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
  };
  return Object.freeze({
    getOptions,
    async getBootstrapReferences() {
      const [options,settingsMap]=await Promise.all([
        getOptions(),
        settings.getSettingsMap_(),
      ]);
      return {
        ...options,
        currencySymbol:settingsMap['Currency Symbol']||'',
        lowStockThreshold:Number(settingsMap['Low Stock Threshold'])||5,
      };
    },
  });
}
