/**
 * M08 first-Shop Counter Supplier Pay — cash only, no live route or flags.
 * A trusted Owner HTTP caller must verify the current Control D1 session,
 * correct Shop binding and Shop write grant. SQL repeats lease authorization.
 * Cash Session close remains blocked after Supplier Pay until the full drawer
 * reconciliation calculation is integrated; never fabricate cash balances.
 */
import {pilotShopIdentityMatches} from '../auth/platform-shop-binding.js';
import {hashOpaqueSessionToken} from '../auth/session-token.js';
import {hashCanonicalOperationIntent} from './operation-intent-fingerprint.js';

const OP=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SUPPLIER=/^SUP-[0-9]{6,}$/;
const MONEY=/^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,2})?$/;
const AUTH=["EXISTS(SELECT 1 FROM shop_identity i",
  "JOIN shop_owner_write_grant g ON g.singleton=i.singleton",
  "WHERE i.singleton=1 AND i.shop_id=? AND i.database_id=?",
  "AND i.database_marker=? AND g.enabled=1 AND g.token_hash=?",
  "AND g.expires_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER))"].join(' ');
const CLEAN=["NOT EXISTS(SELECT 1 FROM legacy_product_snapshots)",
  "AND NOT EXISTS(SELECT 1 FROM products WHERE source_profile='canonical')",
  "AND NOT EXISTS(SELECT 1 FROM party_legacy_links)"].join(' ');
const NOW="CAST(unixepoch('subsec')*1000 AS INTEGER)";
const sourceId=n=>'SPY-'+String(n).padStart(6,'0');
const dhakaDay=()=>new Date(Date.now()+21600000).toISOString().slice(0,10);
function parsePaisa(value){
  const text=typeof value==='number'&&Number.isFinite(value)?String(value):value;
  if(typeof text!=='string'||!MONEY.test(text))return null;
  const [whole,decimal='']=text.split('.');
  const n=BigInt(whole)*100n+BigInt(decimal.padEnd(2,'0')||'0');
  return n>=1n&&n<=1000000000000n?Number(n):null;
}
function plain(x){
  return x!==null&&typeof x==='object'&&!Array.isArray(x)&&
    [Object.prototype,null].includes(Object.getPrototypeOf(x));
}
function validate(payload){
  if(!plain(payload))return {status:'invalid'};
  const keys=['supplierId','amount','paymentMethod','bankAccountId',
    'notes','date','backdatedReason'];
  if(Reflect.ownKeys(payload).some(k=>typeof k!=='string'||!keys.includes(k))||
     keys.some(k=>!Object.hasOwn(payload,k)))return {status:'invalid'};
  if(!SUPPLIER.test(payload.supplierId||''))return {status:'invalid'};
  if(payload.paymentMethod!=='Cash'||payload.bankAccountId!==''||
     payload.backdatedReason!==''||payload.date!==dhakaDay())
    return {status:'unsupported'};
  if(typeof payload.notes!=='string'||payload.notes.length>250||
     /[\u0000-\u001f\u007f]/.test(payload.notes))return {status:'invalid'};
  const amountPaisa=parsePaisa(payload.amount);
  if(amountPaisa===null)return {status:'invalid'};
  return {status:'ok',supplierId:payload.supplierId,amountPaisa,
    notes:payload.notes.trim(),date:payload.date};
}
async function authorize(scope,token,subject){
  if(!scope||typeof scope.shopDb?.prepare!=='function'||
    typeof subject!=='string'||!subject.trim()||
    typeof token!=='string'||!await pilotShopIdentityMatches(scope))return null;
  const digest=await hashOpaqueSessionToken(token);
  if(!digest)return null;
  return {db:scope.shopDb,actorId:'google:'+subject,
    identity:[scope.shopId,scope.databaseId,scope.databaseMarker,digest]};
}
function outcomes(rows){
  if(!Array.isArray(rows)||rows.some(r=>r?.success!==true))
    throw new Error('Supplier Cash posting result unavailable');
}
const isExpectedDenial=error=>/MVP_SUPPLIER_CASH_(?:OWNER_REQUIRED|SESSION_REQUIRED|SUPPLIER_INVALID|NOT_CURRENT_DAY|DUE_CHANGED)|UNIQUE constraint failed|CHECK constraint failed|FOREIGN KEY constraint failed/.test(String(error?.message??''));

export async function postOwnerSupplierCashPayment(scope,{
  token,ownerSubject,operationId,payload
}={}){
  if(typeof operationId!=='string'||!OP.test(operationId))return {status:'invalid'};
  const quote=validate(payload);
  if(quote.status!=='ok')return quote;
  const current=await authorize(scope,token,ownerSubject);
  if(!current)return {status:'denied'};
  const {db,actorId,identity}=current;
  const [shopId,databaseId,databaseMarker,tokenHash]=identity;
  const intent=await hashCanonicalOperationIntent({
    tenantId:shopId,actorId,operationType:'counter.supplier.cash-pay.v1',
    payload:{supplierId:quote.supplierId,amountPaisa:quote.amountPaisa,
      notes:quote.notes,date:quote.date,paymentMethod:'Cash'}
  });
  const insert=[
    "INSERT INTO owner_mvp_supplier_cash_payment_receipts",
    "(operation_id,actor_id,intent_hash,shop_id,database_id,database_marker,",
    "token_hash,supplier_id,cash_sequence,paid_paisa,note_text,paid_date,created_at_ms)",
    "SELECT ?,?,?,?,?,?,?,m.supplier_id,s.sequence,?,?,?,"+NOW,
    "FROM owner_supplier_master m",
    "JOIN parties p ON p.party_id=m.party_id AND p.status='ACTIVE'",
    "JOIN party_roles r ON r.party_id=m.party_id",
    "AND r.role='Supplier' AND r.status='ACTIVE'",
    "CROSS JOIN owner_mvp_cash_sessions s",
    "WHERE m.supplier_id=? AND m.status='Active'",
    "AND m.current_due_paisa>=? AND s.status='Open'",
    "AND "+AUTH+" AND ("+CLEAN+")",
    "AND NOT EXISTS(SELECT 1 FROM owner_mvp_supplier_cash_payment_receipts WHERE operation_id=?)",
    "RETURNING sequence"
  ].join(' ');
  const read=[
    "SELECT "+AUTH+" AS allowed,",
    "(SELECT sequence FROM owner_mvp_cash_sessions WHERE status='Open') AS openSequence,",
    "EXISTS(SELECT 1 FROM owner_supplier_master m",
    "JOIN parties p ON p.party_id=m.party_id AND p.status='ACTIVE'",
    "JOIN party_roles r ON r.party_id=m.party_id",
    "AND r.role='Supplier' AND r.status='ACTIVE'",
    "WHERE m.supplier_id=? AND m.status='Active') AS supplierActive,",
    "(SELECT current_due_paisa FROM owner_supplier_master WHERE supplier_id=?) AS currentDue,",
    "receipt.sequence,receipt.actor_id,receipt.intent_hash,",
    "receipt.paid_paisa,receipt.supplier_id",
    "FROM (SELECT 1) x",
    "LEFT JOIN owner_mvp_supplier_cash_payment_receipts receipt ON receipt.operation_id=?"
  ].join(' ');
  let inserted,state;
  try{
    [inserted,state]=await db.batch([
      db.prepare(insert).bind(operationId,actorId,intent,shopId,databaseId,
        databaseMarker,tokenHash,quote.amountPaisa,quote.notes,quote.date,
        quote.supplierId,quote.amountPaisa,...identity,operationId),
      db.prepare(read).bind(...identity,quote.supplierId,quote.supplierId,operationId)
    ]);
  }catch(error){
    if(/MVP_SUPPLIER_CASH_INSUFFICIENT_DRAWER/.test(String(error?.message??'')))
      return {status:'insufficient-cash'};
    if(isExpectedDenial(error))return {status:'denied'};
    throw error; // Unknown errors are not successful payments.
  }
  outcomes([inserted,state]);
  const row=state.results?.[0];
  if(row?.allowed!==1)return {status:'denied'};
  if(row.sequence!=null){
    if(row.actor_id!==actorId||row.intent_hash!==intent||
      row.supplier_id!==quote.supplierId||row.paid_paisa!==quote.amountPaisa)
      return {status:'conflict'};
    if(!Number.isSafeInteger(row.currentDue)||row.currentDue<0)
      throw new Error('Supplier due unavailable');
    return {status:inserted.results.length===1?'created':'replayed',
      paymentId:sourceId(row.sequence),supplierId:quote.supplierId,
      amount:quote.amountPaisa/100,currentDue:row.currentDue/100};
  }
  if(!row.openSequence)return {status:'session-required'};
  if(row.supplierActive!==1)return {status:'denied'};
  if(!Number.isSafeInteger(row.currentDue)||row.currentDue<quote.amountPaisa)
    return {status:'insufficient-due'};
  return {status:'denied'};
}

/** Authorized, bounded readback of new Supplier Payment receipts only. */
export async function readOwnerSupplierCashPayments(scope,{
  token,ownerSubject,supplierId
}={}){
  if(typeof supplierId!=='string'||!SUPPLIER.test(supplierId))
    return {status:'invalid'};
  const current=await authorize(scope,token,ownerSubject);
  if(!current)return {status:'denied'};
  const {db,identity}=current;
  const [authorizedRow,rows]=await db.batch([
    db.prepare("SELECT "+AUTH+" AS allowed,"+
      "(SELECT current_due_paisa FROM owner_supplier_master WHERE supplier_id=?) AS currentDuePaisa")
      .bind(...identity,supplierId),
    db.prepare([
      "SELECT 'SPY-'||printf('%06d',r.sequence) AS paymentId,",
      "r.supplier_id AS supplierId,r.paid_paisa AS paidPaisa,",
      "r.paid_date AS paidDate,r.created_at_ms AS occurredAtMs,",
      "r.cash_sequence AS cashSequence",
      "FROM owner_mvp_supplier_cash_payment_receipts r",
      "JOIN owner_mvp_supplier_payment_ledger l ON l.payment_sequence=r.sequence",
      "AND l.supplier_id=r.supplier_id AND l.credit_paisa=r.paid_paisa",
      "JOIN owner_mvp_supplier_payment_cash_book b ON b.payment_sequence=r.sequence",
      "AND b.cash_sequence=r.cash_sequence AND b.paid_paisa=r.paid_paisa",
      "WHERE r.supplier_id=? ORDER BY r.sequence DESC LIMIT 51"
    ].join(' ')).bind(supplierId)
  ]);
  outcomes([authorizedRow,rows]);
  const state=authorizedRow.results?.[0];
  if(state?.allowed!==1)return {status:'denied'};
  if(state.currentDuePaisa==null)return {status:'not-found'};
  if(!Number.isSafeInteger(state.currentDuePaisa))
    throw new Error('Supplier due unavailable');
  if(!Array.isArray(rows.results)||rows.results.some(x=>
    !Number.isSafeInteger(x.paidPaisa)||!Number.isSafeInteger(x.cashSequence)))
    throw new Error('Supplier cash payment history unavailable');
  return {status:'ok',supplierId,currentDuePaisa:state.currentDuePaisa,
    entries:rows.results.slice(0,50),hasMore:rows.results.length>50};
}
