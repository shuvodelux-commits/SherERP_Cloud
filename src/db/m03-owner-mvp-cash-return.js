/**
 * One real clean-Shop Cash Sales Return of the immutable 0007 Cash Sale.
 * Reuse original M07 Cash refund semantics and the same original FIFO draw;
 * never reinterpret historical Sale lots or fabricate Party/Bank movements.
 * Pilot: one Standard SKU, whole units, exact original price, same-day cash.
 * SQL-time current Owner/Shop/write grant, Cash Session, original sale quantity,
 * lot restore and money conservation are REQUIRED for every mutation.
 */
import {pilotShopIdentityMatches} from '../auth/platform-shop-binding.js';
import {hashOpaqueSessionToken} from '../auth/session-token.js';
import {hashCanonicalOperationIntent} from './operation-intent-fingerprint.js';

const OP=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INV=/^INV-[0-9]{6,}$/;
const SKU=/^PRD-[0-9]{6,}$/;
const MONEY=/^\d+(?:\.\d{1,2})?$/;
const NOW="CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const AUTH=`EXISTS(SELECT 1 FROM shop_identity i
  JOIN shop_owner_write_grant g ON g.singleton=i.singleton
  WHERE i.singleton=1 AND i.shop_id=? AND i.database_id=? AND i.database_marker=?
  AND g.enabled=1 AND g.token_hash=? AND g.expires_at_ms>${NOW})`;
const CLEAN=`NOT EXISTS(SELECT 1 FROM legacy_product_snapshots)
  AND NOT EXISTS(SELECT 1 FROM products WHERE source_profile='canonical')
  AND NOT EXISTS(SELECT 1 FROM party_legacy_links)`;
const day=()=>new Date(Date.now()+21600000).toISOString().slice(0,10);
const saleSeq=id=>Number(id.slice(4));
const returnId=seq=>'SRT-'+String(seq).padStart(6,'0');
const money=n=>n/100;
function parsePaisa(value){
  const text=typeof value==='number'&&Number.isFinite(value)?String(value):value;
  if(typeof text!=='string'||!MONEY.test(text)||text.length>14)return null;
  const [whole,dec='']=text.split('.');
  const paisa=Number(whole)*100+Number(dec.padEnd(2,'0')||'0');
  return Number.isSafeInteger(paisa)&&paisa>=0&&paisa<=1_000_000_000_000?paisa:null;
}
function clean(value,max){
  if(typeof value!=='string'||value.length>max||/[\u0000-\u001f\u007f]/.test(value))return null;
  return value.trim();
}
function plain(value){
  return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
    [Object.prototype,null].includes(Object.getPrototypeOf(value));
}
function validate(raw){
  if(!plain(raw))return {status:'invalid'};
  const keys=['invoiceId','items','refundMethod','reason','notes','date','backdatedReason','operationId'];
  if(Object.keys(raw).some(k=>!keys.includes(k)))return {status:'unsupported'};
  if(!INV.test(raw.invoiceId||''))return {status:'invalid'};
  if(raw.refundMethod!=='Cash'||!Array.isArray(raw.items)||raw.items.length!==1)
    return {status:'unsupported'};
  const item=raw.items[0];
  if(!plain(item)||Object.keys(item).some(k=>!['productId','name','qty','price'].includes(k)))
    return {status:'unsupported'};
  if(!SKU.test(item.productId||'')||!Number.isSafeInteger(item.qty)||
     item.qty<1||item.qty>1000)return {status:'invalid'};
  const price=parsePaisa(item.price);
  if(price===null||price<1)return {status:'invalid'};
  const reason=clean(raw.reason,250),notes=clean(raw.notes,250);
  if(reason===null||notes===null||clean(raw.backdatedReason||'',250)===null)
    return {status:'invalid'};
  if(raw.date!==day() || (raw.backdatedReason||'')!=='')return {status:'unsupported'};
  return {status:'ok',invoiceId:raw.invoiceId,productId:item.productId,
    qtyMicro:item.qty*1_000_000,price,total:item.qty*price,
    reason,notes,date:raw.date};
}
async function actorAuthority(scope,token){
  if(!scope||typeof scope.shopDb?.prepare!=='function'||!await pilotShopIdentityMatches(scope))
    return null;
  const digest=await hashOpaqueSessionToken(token);
  if(!digest)return null;
  const parameters=[scope.shopId,scope.databaseId,scope.databaseMarker,digest];
  const row=await scope.shopDb.prepare(`SELECT ${AUTH} AS allowed`).bind(...parameters).first();
  return row?.allowed===1?parameters:null;
}
function postedReturn(row){
  return {returnId:returnId(row.sequence),totalReturnAmount:money(row.total_paisa),
    customerId:'',newDue:null};
}
async function readPostedReturn(DB,operationId){
  const row=await DB.prepare(`SELECT r.sequence,r.actor_id,r.intent_hash,r.total_paisa
    FROM owner_mvp_sale_return_receipts r
    JOIN owner_mvp_return_stock_movements movement ON movement.return_sequence=r.sequence
      AND movement.quantity_micro=r.quantity_micro AND movement.lot_sequence=r.lot_sequence
    JOIN owner_mvp_return_cash_book cash ON cash.return_sequence=r.sequence
      AND cash.debit_paisa=r.total_paisa AND cash.cash_sequence=r.cash_sequence
    WHERE r.operation_id=?`).bind(operationId).first();
  return row;
}

/** Source-shaped original Return screen read from one immutable settled Cash Sale. */
export async function readOwnerInvoiceForReturn(DB,invoiceId){
  if(typeof invoiceId!=='string'||!INV.test(invoiceId))return null;
  const n=saleSeq(invoiceId);
  if(!Number.isSafeInteger(n)||n<1)return null;
  const row=await DB.prepare(`SELECT sale.sequence,sale.product_id,sale.product_name,
    sale.quantity_micro,sale.unit_price_paisa,sale.subtotal_paisa,
    sale.customer_name,sale.customer_phone,sale.customer_address,sale.created_at_ms,
    paid.received_paisa,COALESCE(SUM(ret.quantity_micro),0) AS returned_micro,
    COALESCE(SUM(ret.total_paisa),0) AS returned_paisa
    FROM owner_mvp_sale_receipts sale
    JOIN owner_mvp_sale_fifo_draws draw ON draw.sale_sequence=sale.sequence
      AND draw.lot_sequence=sale.lot_sequence AND draw.quantity_micro=sale.quantity_micro
    JOIN owner_mvp_sale_cash_book paid ON paid.sale_sequence=sale.sequence
      AND paid.received_paisa=sale.subtotal_paisa
    LEFT JOIN owner_mvp_sale_return_receipts ret ON ret.sale_sequence=sale.sequence
    WHERE sale.sequence=? GROUP BY sale.sequence`).bind(n).first();
  if(!row || row.returned_micro>row.quantity_micro ||
    row.returned_paisa>row.received_paisa) return null;
  const amount=money(row.subtotal_paisa);
  const refunded=money(row.returned_paisa);
  const originalDay=new Date(row.created_at_ms+21600000).toISOString().slice(0,10);
  return {
    invoiceId,date:originalDay,customerId:'',customerName:row.customer_name,
    customerPhone:row.customer_phone,customerAddress:row.customer_address,
    grandTotal:amount,paidAmount:amount,dueAmount:0,paymentDetailVersion:'',
    previouslyReturnedAmount:refunded,netSale:amount-refunded,
    cashRefundAvailable:money(row.received_paisa-row.returned_paisa),
    items:[{productId:row.product_id,name:row.product_name,
      unitPrice:money(row.unit_price_paisa),soldQty:row.quantity_micro/1_000_000,
      previouslyReturnedQty:row.returned_micro/1_000_000,
      availableQty:(row.quantity_micro-row.returned_micro)/1_000_000,
      vendorSourcedQty:0}]
  };
}

/** One bounded query for invoice ID or source walk-in phone. No Party merge. */
export async function searchOwnerInvoicesForReturn(DB,query){
  if(typeof query!=='string'||!query.trim()||query.length>80)return [];
  const q=query.trim().toLowerCase();
  const result=await DB.prepare(`SELECT sequence,customer_name AS customerName,
    customer_phone AS customerPhone,subtotal_paisa AS total,created_at_ms AS createdAtMs
    FROM owner_mvp_sale_receipts
    WHERE lower('INV-'||printf('%06d',sequence)) LIKE ? OR lower(customer_phone) LIKE ?
    ORDER BY sequence DESC LIMIT 21`).bind('%'+q+'%','%'+q+'%').all();
  if(result?.success!==true||result.results.length>20)
    throw new Error('Incomplete invoice search');
  return result.results.map(row=>({
    invoiceId:'INV-'+String(row.sequence).padStart(6,'0'),
    date:new Date(row.createdAtMs+21600000).toISOString().slice(0,10),
    customerName:row.customerName,customerPhone:row.customerPhone,
    grandTotal:money(row.total),paymentStatus:'Paid'
  }));
}

/** Single atomic INSERT+SQL triggers performs refund, original-lot stock and receipt. */
export async function postOwnerCashReturn(scope,{token,ownerSubject,operationId,payload}={}){
  if(typeof operationId!=='string'||!OP.test(operationId))return {status:'invalid'};
  if(typeof ownerSubject!=='string'||!ownerSubject.trim())return {status:'denied'};
  const authorized=await actorAuthority(scope,token);
  if(!authorized)return {status:'denied'};
  const quote=validate(payload);
  if(quote.status!=='ok')return quote;
  const DB=scope.shopDb,actorId='google:'+ownerSubject;
  const intent=await hashCanonicalOperationIntent({
    tenantId:scope.shopId,actorId,operationType:'sales.return.cash.v1',
    payload:{returnJson:JSON.stringify(payload)}
  });
  // Replay must precede new quantity/price validation: the first completed
  // refund already restored its lot and reduced remaining returnable units.
  const prior=await DB.prepare(`SELECT sequence,actor_id,intent_hash
    FROM owner_mvp_sale_return_receipts WHERE operation_id=?`).bind(operationId).first();
  if(prior){
    if(prior.actor_id!==actorId||prior.intent_hash!==intent)return {status:'conflict'};
    const row=await readPostedReturn(DB,operationId);
    return row?{status:'replayed',...postedReturn(row)}:{status:'unavailable'};
  }
  const n=saleSeq(quote.invoiceId);
  if(!Number.isSafeInteger(n)||n<1)return {status:'invalid'};
  const source=await DB.prepare(`SELECT sale.sequence,sale.product_id,sale.lot_sequence,
    sale.quantity_micro,sale.unit_price_paisa,
    COALESCE((SELECT SUM(r.quantity_micro)
      FROM owner_mvp_sale_return_receipts r
      WHERE r.sale_sequence=sale.sequence),0) AS returned_qty
    FROM owner_mvp_sale_receipts sale WHERE sale.sequence=?`).bind(n).first();
  if(!source)return {status:'denied'};
  if(source.product_id!==quote.productId)return {status:'declined'};
  if(source.unit_price_paisa!==quote.price)return {status:'unsupported'};
  if(quote.qtyMicro>source.quantity_micro-source.returned_qty)return {status:'declined'};
  const cash=await DB.prepare(`SELECT sequence FROM owner_mvp_cash_sessions
    WHERE status='Open'`).first();
  if(!cash)return {status:'session-required'};
  const inserted=DB.prepare(`INSERT INTO owner_mvp_sale_return_receipts
    (operation_id,actor_id,intent_hash,sale_sequence,cash_sequence,lot_sequence,
     product_id,quantity_micro,unit_refund_paisa,total_paisa,return_date,
     reason_text,notes_text,created_at_ms)
    SELECT ?,?,?,sale.sequence,s.sequence,sale.lot_sequence,sale.product_id,
      ?,?,?,?,?,?,${NOW}
    FROM owner_mvp_sale_receipts sale
    JOIN owner_mvp_sale_fifo_draws draw ON draw.sale_sequence=sale.sequence
      AND draw.lot_sequence=sale.lot_sequence
    JOIN owner_mvp_cash_sessions s ON s.status='Open'
    WHERE sale.sequence=? AND sale.product_id=? AND sale.unit_price_paisa=?
      AND ${AUTH} AND (${CLEAN})
      AND NOT EXISTS(SELECT 1 FROM owner_mvp_sale_return_receipts WHERE operation_id=?)
    RETURNING sequence`).bind(operationId,actorId,intent,
      quote.qtyMicro,quote.price,quote.total,quote.date,quote.reason,quote.notes,
      n,quote.productId,quote.price,...authorized,operationId);
  let batch;
  try{
    batch=await DB.batch([
      inserted,
      DB.prepare(`SELECT ${AUTH} AS allowed,
        (SELECT sequence FROM owner_mvp_cash_sessions WHERE status='Open') AS openSequence,
        r.sequence,r.actor_id,r.intent_hash
        FROM (SELECT 1) x
        LEFT JOIN owner_mvp_sale_return_receipts r ON r.operation_id=?`)
        .bind(...authorized,operationId)
    ]);
  }catch(error){
    if(/MVP_RETURN_|FOREIGN KEY|CHECK constraint|UNIQUE constraint/i.test(String(error?.message||'')))
      return {status:'declined'};
    throw error;
  }
  if(batch.some(x=>x?.success!==true))throw new Error('Unverified Owner Cash Return transaction');
  const state=batch[1].results?.[0];
  if(state?.allowed!==1)return {status:'denied'};
  if(state.actor_id!==null&&state.actor_id!==undefined&&
     (state.actor_id!==actorId||state.intent_hash!==intent))return {status:'conflict'};
  if(!state.openSequence)return {status:'session-required'};
  if(!Number.isSafeInteger(state.sequence)||state.sequence<1)return {status:'declined'};
  const posted=await readPostedReturn(DB,operationId);
  return posted?{status:batch[0].results.length===1?'created':'replayed',
    ...postedReturn(posted)}:{status:'unavailable'};
}
