import {createSettingsReadAdapter} from '../db/settings-read.js';
import {projectReportsBootstrap} from './reports-bootstrap-read.js';
import {reportDefaultRange} from './report-date-range.js';

/**
 * Internal read-only M09 bootstrap from the existing M03 D1 Settings adapter.
 * The caller must supply trusted shop-local YYYY-MM-DD and later enforce
 * M04 reports:view, actor/tenant scope before any authorized RPC integration.
 * Fixed-key shell Settings SQL excludes private keys; no public endpoint.
 */
export function createReportsBootstrapD1Reader(env){
  const settings=createSettingsReadAdapter(env);
  return Object.freeze({
    async getBootstrap(today){
      // Fail before D1 I/O for an invalid/untrusted shop-local date.
      reportDefaultRange(today);
      const shell=await settings.getAppShellSettings_();
      return projectReportsBootstrap({
        'Shop Name':shell.shopName,
        'Currency Symbol':shell.currencySymbol,
      },today);
    }
  });
}
