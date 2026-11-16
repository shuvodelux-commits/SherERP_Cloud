/**
 * M09 INTERNAL Day Book D1 source inventory: no rows, RPC or finance writes.
 * Legacy table names are NOT evidence of complete original business data.
 * Caller supplies trusted bearer+clock; one SQL statement checks permission
 * and inspects sqlite_schema, so revocation cannot race a second read.
 */
import {requireD1Binding} from '../db/d1-binding.js';
import {AUTH_POLICY} from '../auth/d1-auth-core.js';
import {tokenFingerprint} from '../auth/d1-legacy-rpc.js';

const TOKEN=/^[a-f0-9]{64}$/;
const GROUPS=Object.freeze([
  ['sales','SALES'],['salesReturns','SALES_RETURN'],
  ['purchases','PURCHASES'],['purchaseReturns','PURCHASE_RETURN'],
  ['customerLedgerRows','CUSTOMER_LEDGER'],
  ['supplierLedgerRows','SUPPLIER_LEDGER'],
  ['expenses','EXPENSES'],['financeTransactions','FINANCE_TRANSACTIONS'],
  ['bankTransfers','BANK_TRANSFERS'],['bankEntries','BANK_BOOK'],
  ['stockMovements','STOCK_MOVEMENT'],['cashBookRows','CASH_BOOK']
]);
// Fixed source names; NEVER interpolate table names or other user input.
const READ="WITH authorized AS (\n SELECT 1 AS permitted FROM auth_sessions AS s\n JOIN auth_users AS u ON u.user_id=s.user_id\n LEFT JOIN auth_roles AS r ON r.role_name=u.role_name\n WHERE s.token_hash=? AND s.revoked_at_ms IS NULL\n AND s.created_at_ms<=? AND s.expires_at_ms>?\n AND s.last_activity_at_ms>? AND s.last_activity_at_ms<=?\n AND u.status='Active' AND u.credential_state='Modern'\n AND u.auth_version=s.user_auth_version\n AND u.credential_version=s.credential_version\n AND ((u.role_name='Administrator' AND s.role_auth_version IS NULL)\n OR (u.role_name<>'Administrator' AND r.status='Active'\n AND r.auth_version=s.role_auth_version\n AND length(r.permissions_json)<=65536\n AND CASE WHEN json_valid(r.permissions_json) THEN\n   json_type(r.permissions_json)='object'\n   AND json_type(r.permissions_json,'$.daybook')='object'\n   AND json_type(r.permissions_json,'$.daybook.view')='true'\n ELSE 0 END))\n LIMIT 1\n), required(source_index,group_key,table_name) AS (\n VALUES\n (0,'sales','SALES'),\n (1,'salesReturns','SALES_RETURN'),\n (2,'purchases','PURCHASES'),\n (3,'purchaseReturns','PURCHASE_RETURN'),\n (4,'customerLedgerRows','CUSTOMER_LEDGER'),\n (5,'supplierLedgerRows','SUPPLIER_LEDGER'),\n (6,'expenses','EXPENSES'),\n (7,'financeTransactions','FINANCE_TRANSACTIONS'),\n (8,'bankTransfers','BANK_TRANSFERS'),\n (9,'bankEntries','BANK_BOOK'),\n (10,'stockMovements','STOCK_MOVEMENT'),\n (11,'cashBookRows','CASH_BOOK')\n)\nSELECT required.source_index AS source_index,\n required.group_key AS group_key,\n CAST(EXISTS (SELECT 1 FROM sqlite_schema AS sc\n  WHERE sc.type='table' AND sc.name=required.table_name) AS INTEGER) AS source_present\n FROM authorized CROSS JOIN required\n ORDER BY required.source_index ASC";

function validateRequest(request){
  if(!request || typeof request!=='object' || Array.isArray(request) ||
     (Object.getPrototypeOf(request)!==Object.prototype &&
      Object.getPrototypeOf(request)!==null))
    throw new TypeError('Invalid trusted Day Book readiness request');
  const fields=Object.getOwnPropertyDescriptors(request);
  if(Reflect.ownKeys(fields).length!==2 ||
     Reflect.ownKeys(fields).some(k=>typeof k!=='string' ||
       (k!=='token' && k!=='nowMs') ||
       !Object.hasOwn(fields[k],'value') || !fields[k].enumerable))
    throw new TypeError('Invalid trusted Day Book readiness request fields');
  const token=fields.token?.value,nowMs=fields.nowMs?.value;
  if(typeof token!=='string' || !TOKEN.test(token) ||
     !Number.isSafeInteger(nowMs) || nowMs<0 ||
     !Number.isSafeInteger(nowMs+AUTH_POLICY.sessionMaxMs))
    throw new TypeError('Invalid trusted Day Book bearer or time');
  return {token,nowMs};
}

function decode(response){
  if(response?.success!==true || !Array.isArray(response.results) ||
    response.results.length>GROUPS.length)
    throw new Error('Day Book source readiness unavailable');
  const rows=response.results;
  // Denied actors receive zero rows. Authorized actors always receive 12.
  if(rows.length===0)throw new Error('Day Book source readiness denied');
  if(rows.length!==GROUPS.length)
    throw new Error('Day Book source readiness unavailable');
  const presentLegacyGroups=[],missingLegacyGroups=[];
  for(let i=0;i<GROUPS.length;i++){
    const entry=rows[i];
    if(!entry || typeof entry!=='object' || Array.isArray(entry))
      throw new Error('Day Book source readiness unavailable');
    const fields=Object.getOwnPropertyDescriptors(entry);
    if(Reflect.ownKeys(fields).length!==3 ||
       Reflect.ownKeys(fields).some(k=>typeof k!=='string' ||
         !['source_index','group_key','source_present'].includes(k) ||
         !Object.hasOwn(fields[k],'value')))
      throw new Error('Day Book source readiness unavailable');
    if(fields.source_index?.value!==i ||
       fields.group_key?.value!==GROUPS[i][0] ||
       (fields.source_present?.value!==0 && fields.source_present?.value!==1))
      throw new Error('Day Book source readiness unavailable');
    (fields.source_present.value===1?presentLegacyGroups:missingLegacyGroups)
      .push(GROUPS[i][0]);
  }
  return {
    // Table existence NEVER certifies source provenance, tenant or finance.
    ready:false,
    status:missingLegacyGroups.length
      ? 'MISSING_SOURCE_GROUPS':'SOURCE_PROVENANCE_UNVERIFIED',
    presentLegacyGroups,missingLegacyGroups
  };
}

/** Internal local D1 diagnostic. No public Worker endpoint or data reads. */
export function createM09DayBookSourceReadinessReader(env){
  const DB=requireD1Binding(env);
  return Object.freeze({
    async inspect(request){
      const {token,nowMs}=validateRequest(request);
      const fingerprint=await tokenFingerprint(token);
      if(!fingerprint)throw new Error('Day Book source readiness denied');
      let response;
      try{
        response=await DB.prepare(READ).bind(
          fingerprint,nowMs,nowMs,nowMs-AUTH_POLICY.sessionIdleMs,nowMs
        ).all();
      }catch{
        throw new Error('Day Book source readiness unavailable');
      }
      return decode(response);
    }
  });
}
