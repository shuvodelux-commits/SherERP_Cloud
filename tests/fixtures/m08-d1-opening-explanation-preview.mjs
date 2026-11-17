/**
 * M08 opening Cash explanation projection from real *local* D1.
 *
 * TEST-ONLY READ: uses one tenant-scoped D1.batch snapshot, rebuilding
 * source-shaped arrays for the already source-verified pure validator.
 * It does not authenticate callers, authorize a write, retire synthetic
 * Session Open movements or expose an RPC endpoint. Never deploy.
 */
import {validateCashReconciliationExplanation}
  from '../../src/modules/m08-reconciliation-explanation-validation.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const KEYS=['entryIds','phase','sessionId','tenantId','timeZone'];
const SESSIONS=`SELECT legacy_row,session_id,opened_at,status,opening_cents,
  expected_cents,counted_cents,variance_cents,opening_entry_ids,closing_entry_ids
  FROM m08_opening_sessions WHERE tenant_id=? ORDER BY legacy_row`;
const CASH=`SELECT legacy_row,entry_id,type,reference,date_text,description,
  credit_cents,debit_cents,is_deleted
  FROM m08_opening_cash WHERE tenant_id=? ORDER BY legacy_row`;

function validateInput(value){
  if(!value || typeof value!=='object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value)!==Object.prototype &&
       Object.getPrototypeOf(value)!==null))
    throw new TypeError('Invalid M08 opening request shape');
  const own=Reflect.ownKeys(value);
  if(own.length!==KEYS.length ||
      own.some(key=>typeof key!=='string' || !KEYS.includes(key)) ||
      own.some(key=>{
        const descriptor=Object.getOwnPropertyDescriptor(value,key);
        return !descriptor?.enumerable || !Object.hasOwn(descriptor,'value');
      }))
    throw new TypeError('Invalid M08 opening request fields');
  const v={};
  for(const key of KEYS)v[key]=Object.getOwnPropertyDescriptor(value,key).value;
  if(typeof v.tenantId!=='string' || !ID.test(v.tenantId) ||
     typeof v.sessionId!=='string' || !ID.test(v.sessionId) ||
     typeof v.phase!=='string' || v.phase.toLowerCase()!=='opening' ||
     typeof v.timeZone!=='string' || !v.timeZone.trim() ||
     v.timeZone.length>100)
    throw new TypeError('Invalid M08 opening tenant, phase or timezone');

  if(typeof v.entryIds==='string'){
    if(!v.entryIds.trim() || v.entryIds.length>4096)
      throw new TypeError('Invalid M08 opening Cash entry selection');
  }else if(Array.isArray(v.entryIds)){
    if(v.entryIds.length===0 || v.entryIds.length>100 ||
       v.entryIds.some(id=>typeof id!=='string'||!id.trim()||id.length>64))
      throw new TypeError('Invalid M08 opening Cash entry selection');
  }else throw new TypeError('Invalid M08 opening Cash entry selection');
  // The original GAS parser is applied by the shared source-parity validator.
  return v;
}

function safePart(part){
  if(!part || part.success!==true || !Array.isArray(part.results))
    throw new Error('M08 opening local D1 snapshot unavailable');
  return part.results;
}
function cents(value){
  if(!Number.isSafeInteger(value))
    throw new Error('Invalid M08 imported Cash cents');
  return value/100;
}
function optionalCents(value){
  return value===null?'':cents(value);
}
function mapSession(s){
  if(!Number.isSafeInteger(s.legacy_row) || s.legacy_row<2 ||
     typeof s.session_id!=='string' || typeof s.opened_at!=='string' ||
     typeof s.status!=='string' ||
     typeof s.opening_entry_ids!=='string' ||
     typeof s.closing_entry_ids!=='string')
    throw new Error('Malformed M08 Cash Session import');
  return {
    _rowIndex:s.legacy_row,
    'Session ID':s.session_id,'Date':'','Opened At':s.opened_at,
    'Status':s.status,'Opening Cash':cents(s.opening_cents),
    'Expected Cash':optionalCents(s.expected_cents),
    'Counted Cash':optionalCents(s.counted_cents),
    'Variance':optionalCents(s.variance_cents),
    'Opening Explanation Entry IDs':s.opening_entry_ids,
    'Closing Explanation Entry IDs':s.closing_entry_ids
  };
}
function mapCash(row){
  if(!Number.isSafeInteger(row.legacy_row) || row.legacy_row<2 ||
     typeof row.entry_id!=='string' || typeof row.type!=='string' ||
     typeof row.reference!=='string' || typeof row.date_text!=='string' ||
     typeof row.description!=='string' || (row.is_deleted!==0 && row.is_deleted!==1))
    throw new Error('Malformed M08 Cash Book import');
  return {
    _rowIndex:row.legacy_row,'Entry ID':row.entry_id,
    'Type':row.type,'Reference':row.reference,'Date':row.date_text,
    'Description':row.description,'Credit':cents(row.credit_cents),
    'Debit':cents(row.debit_cents),
    'Is Deleted':row.is_deleted===1?'TRUE':''
  };
}

/**
 * Returns frozen-source-compatible explanation validation data, without
 * posting any cash movement or link. This is not an authorization decision.
 */
export async function previewD1OpeningCashExplanation(DB,input){
  if(!DB || typeof DB.prepare!=='function' || typeof DB.batch!=='function')
    throw new TypeError('D1 opening Cash binding unavailable');
  const v=validateInput(input);
  const result=await DB.batch([
    DB.prepare(SESSIONS).bind(v.tenantId),
    DB.prepare(CASH).bind(v.tenantId)
  ]);
  if(!Array.isArray(result) || result.length!==2)
    throw new Error('M08 opening local D1 batch incomplete');
  const sessions=safePart(result[0]).map(mapSession);
  const cash=safePart(result[1]).map(mapCash);
  return validateCashReconciliationExplanation(sessions,cash,{
    sessionId:v.sessionId,phase:'opening',entryIds:v.entryIds,timeZone:v.timeZone
  });
}
