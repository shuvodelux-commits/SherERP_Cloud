/**
 * M09 internal source-faithful Reports bootstrap projection.
 *
 * Source: pinned Mohim_ERP Reports.gs::getReportsBootstrap, REPORT_TYPES,
 * Config.gs::APP_NAME and original reports.html.
 *
 * Caller MUST already authorize reports:view, load tenant-scoped original
 * Settings map, and supply explicit shop-local YYYY-MM-DD today.
 * No D1 access, RPC registration, caching, UI mutation or finance posting.
 */
import {reportDefaultRange} from './report-date-range.js';

const REPORT_TYPES=Object.freeze([
  Object.freeze({key:'sales',label:'Sales'}),
  Object.freeze({key:'purchase',label:'Purchase'}),
  Object.freeze({key:'stock',label:'Stock & Valuation'}),
  Object.freeze({key:'cashbank',label:'Cash & Bank'}),
  Object.freeze({key:'profit',label:'Profit'}),
  Object.freeze({key:'balancesheet',label:'Balance Sheet'})
]);
const DEFAULT_APP_NAME='Hardware Store ERP'; // Frozen Config.gs::APP_NAME

function plain(value){
  return value!==null && typeof value==='object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value)===Object.prototype ||
      Object.getPrototypeOf(value)===null);
}
function setting(settings,key){
  const descriptor=Object.getOwnPropertyDescriptor(settings,key);
  if(descriptor && !Object.hasOwn(descriptor,'value'))
    throw new TypeError('Untrusted report Settings accessor: '+key);
  const value=descriptor?.value;
  if(value!==undefined&&value!==null &&
    !['string','number','boolean'].includes(typeof value))
    throw new TypeError('Invalid report Settings scalar: '+key);
  // The original GAS source applies || defaults, including NaN -> default.
  // Infinity is truthy but an invalid trusted Settings value, so reject it.
  if(typeof value==='number' && !Number.isFinite(value) && !Number.isNaN(value))
    throw new TypeError('Invalid finite report Settings scalar: '+key);
  return value;
}

/**
 * Preserves frozen getReportsBootstrap success payload exactly for trusted
 * source-shaped inputs. Each response gets isolated report type objects.
 */
export function projectReportsBootstrap(settingsMap,today){
  if(!plain(settingsMap) ||
    Object.values(Object.getOwnPropertyDescriptors(settingsMap))
      .some(descriptor=>!Object.hasOwn(descriptor,'value')))
    throw new TypeError('Trusted report Settings map must be a plain own-data object');
  const {defaultFrom,defaultTo}=reportDefaultRange(today);
  return {
    reportTypes:REPORT_TYPES.map(row=>({...row})),
    currencySymbol:setting(settingsMap,'Currency Symbol')||'',
    shopName:setting(settingsMap,'Shop Name')||DEFAULT_APP_NAME,
    defaultFrom,
    defaultTo
  };
}
