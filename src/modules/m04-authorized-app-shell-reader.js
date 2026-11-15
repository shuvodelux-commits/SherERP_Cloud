import {createM04AuthorizedShellSettingsReadAdapter} from '../db/m04-settings-view.js';
import {buildSourceAppShellData} from './source-app-shell-reader.js';

/**
 * Internal, single-business M03/M04 application shell read.
 *
 * The existing M04 adapter authenticates the session and checks the current
 * settings.view grant in the SAME D1 SELECT that returns only the public
 * Shop Name/Currency Symbol keys. A denied or stale session never receives
 * NAV_ITEMS or a successful source-shaped envelope.
 *
 * This does not register getAppShellData as a public RPC. NAV_ITEMS remains
 * presentation metadata, NOT proof of authorization for any module action.
 */
export function createM04AuthorizedAppShellReader(env){
  const settings=createM04AuthorizedShellSettingsReadAdapter(env);
  return Object.freeze({
    async getAppShellData(request){
      return buildSourceAppShellData(await settings.getAppShellSettings_(request));
    }
  });
}
