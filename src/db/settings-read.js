import {requireD1Binding} from './d1-binding.js';

// M03 source-shaped read-only Settings adapter, NOT a public RPC.
// Original Database.gs getSettingsMap_ reads rows as-is: no implicit defaults.
// All queries use fixed SQL, no caller-selected identifiers.
const MAX_SETTINGS_ROWS=256;
const READ_ALL='SELECT key, value FROM settings ORDER BY row_id ASC LIMIT ?';
const READ_SHELL=`SELECT key, value FROM settings
  WHERE key IN ('Shop Name','Currency Symbol') ORDER BY row_id ASC LIMIT ?`;
const SHELL_KEYS=new Set(['Shop Name','Currency Symbol']);
const FORBIDDEN_KEYS=new Set(['__proto__','constructor','prototype']);
const DEFAULT_APP_NAME='Hardware Store ERP'; // pinned Config.gs CONFIG.APP_NAME

function readOwnString(row,name){
  if(row===null || typeof row!=='object' || Array.isArray(row))
    throw new Error('Invalid D1 Settings row');
  const prop=Object.getOwnPropertyDescriptor(row,name);
  if(!prop || !Object.hasOwn(prop,'value') || typeof prop.value!=='string')
    throw new Error('Invalid D1 Settings row value');
  return prop.value;
}

function mapRows(response,limit,allowedKeys){
  if(response?.success!==true || !Array.isArray(response.results) ||
      response.results.length>limit)
    throw new Error('Invalid D1 Settings result or Settings read limit exceeded');
  const map=Object.create(null);
  for(const row of response.results){
    const key=readOwnString(row,'key');
    const value=readOwnString(row,'value');
    if(!key.trim() || FORBIDDEN_KEYS.has(key) ||
        (allowedKeys && !allowedKeys.has(key)) ||
        Object.hasOwn(map,key)){
      throw new Error('Invalid, unsafe or duplicate D1 Settings key');
    }
    map[key]=value;
  }
  return map;
}

/**
 * Match pinned Utils.gs isSettingEnabled_ for real Sheets booleans and D1
 * text. Only an explicit boolean true or string "true" enables a setting;
 * unknown/blank/undefined falls back to the strictly boolean default.
 */
export function isSettingEnabled_(settingValue,defaultWhenUnset){
  if(settingValue===true)return true;
  if(settingValue===false)return false;
  const s=String(settingValue===null || settingValue===undefined?'':settingValue).trim().toLowerCase();
  if(s==='true')return true;
  if(s==='false')return false;
  return defaultWhenUnset===true;
}

/**
 * Internal async Settings reads; never mount methods as /api/rpc without
 * M04 auth+permission review. No cross-request cache and no mutations.
 * getAppShellSettings_ deliberately omits NAV_ITEMS and private keys.
 */
export function createSettingsReadAdapter(env){
  const DB=requireD1Binding(env);
  return Object.freeze({
    async getSettingsMap_(){
      const response=await DB.prepare(READ_ALL).bind(MAX_SETTINGS_ROWS+1).all();
      return mapRows(response,MAX_SETTINGS_ROWS);
    },
    async getAppShellSettings_(){
      const response=await DB.prepare(READ_SHELL).bind(SHELL_KEYS.size+1).all();
      const settings=mapRows(response,SHELL_KEYS.size,SHELL_KEYS);
      return {
        shopName:settings['Shop Name']||DEFAULT_APP_NAME,
        currencySymbol:settings['Currency Symbol']||''
      };
    }
  });
}
