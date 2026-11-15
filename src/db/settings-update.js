import {requireD1Binding} from './d1-binding.js';

// M03 nonfinancial Settings migration slice, not a public settings.edit RPC.
// Exact key allowlist: these are the two reviewed keys already exposed by
// the internal source-shaped shell read projection in settings-read.js.
const EDITABLE_SHELL_KEYS=new Set(['Shop Name','Currency Symbol']);

// A single SQLite statement performs the old-value comparison and mutation.
// No JS read-before-write, dynamic SQL identifiers, global cache or UPSERT.
const UPDATE_EXISTING=
  'UPDATE settings SET value=? WHERE key=? AND value=? RETURNING key,value';

function validated(key,newValue,expectedValue){
  if(typeof key!=='string' || !EDITABLE_SHELL_KEYS.has(key)){
    throw new TypeError('Invalid or unsupported shell Settings key');
  }
  if(typeof newValue!=='string' || typeof expectedValue!=='string'){
    throw new TypeError('Invalid shell Settings value or preimage');
  }
  // Pinned Utils.gs:sanitizeInput_ uses String(value).trim() for text.
  // Internal callers must already supply strings; do not coerce objects.
  const value=newValue.trim();
  if(key==='Shop Name' && !value){
    throw new TypeError('Shop Name is required');
  }
  return value;
}

/**
 * Guarded update of ONE EXISTING reviewed shell Settings row.
 *
 * expectedValue is the exact previous D1 text, not a client authority.
 * SQL-level CAS rejects stale writes; a missing key stays missing.
 * This helper neither authenticates callers nor implements full GAS
 * updateSettings. M04 permission checks are mandatory before future wiring.
 */
export function createGuardedShellSettingsUpdateAdapter(env){
  const DB=requireD1Binding(env);
  return Object.freeze({
    async updateExisting_(key,newValue,expectedValue){
      const value=validated(key,newValue,expectedValue);
      let row;
      try{
        row=await DB.prepare(UPDATE_EXISTING)
          .bind(value,key,expectedValue).first();
      }catch(error){
        throw new Error('NEEDS_REVIEW: D1 Settings update outcome uncertain',{cause:error});
      }
      if(row===null){
        throw new Error('Stale or missing Settings row; update conflict');
      }
      if(!row || row.key!==key || row.value!==value){
        throw new Error('NEEDS_REVIEW: malformed D1 Settings update result');
      }
      return {updated:true};
    }
  });
}
