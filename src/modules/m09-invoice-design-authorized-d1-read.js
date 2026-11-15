/**
 * M09 INTERNAL Invoice Design source-bootstrap reader for isolated,
 * single-business D1 only. NOT a public RPC, not shared-tenant ready.
 *
 * Source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * Settings.gs::getInvoiceDesignBootstrap + Invoice.gs logo resolver.
 *
 * M04 settings:view is enforced in the SAME D1 statement that reads the
 * complete Settings map; never authorize in JS then query it unguarded.
 * Existing Google Drive logo IDs cannot be resolved safely until an
 * approved logo asset migration; reject instead of losing invoice art.
 */
import {createM04AuthorizedShellSettingsReadAdapter}
  from '../db/m04-settings-view.js';
import {projectInvoiceDesignBootstrap}
  from './settings-invoice-bootstrap-read.js';

export function createM09AuthorizedInvoiceDesignD1Reader(env){
  const settings=createM04AuthorizedShellSettingsReadAdapter(env);
  return Object.freeze({
    async getBootstrap(request){
      const sourceMap=await settings.getSettingsMap_(request);
      if(sourceMap['Invoice Logo']){
        // Do not expose source File ID, external URL, or a fake empty logo.
        // An unresolved legacy logo means the report is NOT source-faithful.
        throw new Error('NEEDS_REVIEW: Invoice logo asset migration is not available');
      }
      return projectInvoiceDesignBootstrap(sourceMap,'');
    }
  });
}
