/**
 * TEST-ONLY M08 positional Cash Session projection.
 * A tenant-scoped D1.batch reads both original-ordered source tables,
 * then reuses the independently tested, read-only GAS parity calculator.
 * No writes, routes, live bindings, migrations or deployment permissions.
 */
import {recalculateClosedSessionCash}
  from '../../src/modules/m08-closed-session-cash-recalculation.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

function validatedIdentity(input){
  if(!input || typeof input!=='object' || Array.isArray(input) ||
     (Object.getPrototypeOf(input)!==Object.prototype &&
      Object.getPrototypeOf(input)!==null))
    throw new TypeError('Invalid M08 positional identity');
  const keys=Reflect.ownKeys(input);
  if(keys.length!==2 || !keys.includes('tenantId') ||
     !keys.includes('sessionId') || keys.some(key=>{
       if(typeof key!=='string')return true;
       const d=Object.getOwnPropertyDescriptor(input,key);
       return !d?.enumerable || !Object.hasOwn(d,'value');
     }))
    throw new TypeError('Invalid M08 positional identity');
  const tenantId=Object.getOwnPropertyDescriptor(input,'tenantId').value;
  const sessionId=Object.getOwnPropertyDescriptor(input,'sessionId').value;
  if(typeof tenantId!=='string' || !ID.test(tenantId) ||
     typeof sessionId!=='string' || !ID.test(sessionId))
    throw new TypeError('Invalid M08 positional tenant or session');
  return {tenantId,sessionId};
}

function records(part){
  if(part?.success!==true || !Array.isArray(part.results))
    throw new Error('M08 positional D1 snapshot unavailable');
  return part.results;
}
function cents(value){
  return value/100;
}

/**
 * Result: {sessionId,recalculated:{expected,variance}|null}.
 * The only data source is the isolated, synthetic, tenant-bound test D1.
 */
export async function previewD1PositionalCashReconciliation(DB,input){
  if(!DB || typeof DB.prepare!=='function' || typeof DB.batch!=='function')
    throw new TypeError('D1 positional Cash Session binding unavailable');
  const {tenantId,sessionId}=validatedIdentity(input);
  const [sessionsPart,cashPart]=await DB.batch([
    DB.prepare(`SELECT legacy_row,session_id,status,opening_cents,
                       counted_cents,opening_entry_ids,closing_entry_ids
                FROM m08_positional_sessions
                WHERE tenant_id=? ORDER BY legacy_row`).bind(tenantId),
    DB.prepare(`SELECT legacy_row,entry_id,type,reference,credit_cents,
                       debit_cents,is_deleted,date_text
                FROM m08_positional_cash
                WHERE tenant_id=? ORDER BY legacy_row`).bind(tenantId)
  ]);
  const sessions=records(sessionsPart).map(row=>({
    _rowIndex:row.legacy_row,
    'Session ID':row.session_id,
    'Status':row.status,
    'Opening Cash':cents(row.opening_cents),
    'Counted Cash':row.counted_cents===null?'':cents(row.counted_cents),
    'Opening Explanation Entry IDs':row.opening_entry_ids,
    'Closing Explanation Entry IDs':row.closing_entry_ids
  }));
  const cash=records(cashPart).map(row=>({
    _rowIndex:row.legacy_row,
    'Entry ID':row.entry_id,
    'Type':row.type,
    'Reference':row.reference,
    'Credit':cents(row.credit_cents),
    'Debit':cents(row.debit_cents),
    'Is Deleted':row.is_deleted===1?'TRUE':'',
    'Date':row.date_text
  }));
  const matching=sessions.find(row=>row['Session ID']===sessionId)??null;
  // The reused calculator rejects duplicate source IDs and markers, even
  // if a different candidate session would otherwise look valid.
  return {
    sessionId,
    recalculated:recalculateClosedSessionCash(matching,sessions,cash)
  };
}
