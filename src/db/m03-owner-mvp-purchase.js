/**
 * M03 MVP operational clean-Shop Owner credit Purchase. This is intentionally
 * NOT a full financial Purchase: only base-unit, zero-discount, zero-paid,
 * same-day purchases are accepted until Cash/Bank and multi-unit are integrated.
 * Original source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * SQL-time Owner lease, Open Cash Session and Supplier role are mandatory.
 */
import {hashOpaqueSessionToken} from '../auth/session-token.js';
import {hashCanonicalOperationIntent} from './operation-intent-fingerprint.js';
import {originalSourceIdPrefix} from './m03-source-id-families.js';

const OP=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const PRODUCT=/^PRD-[0-9]{6,}$/;
const SUPPLIER=/^SUP-[0-9]{6,}$/;
const DECIMAL=/^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,2})?$/;
const QTY=/^(?:0|[1-9][0-9]{0,3})(?:\.[0-9]{1,6})?$/;
const LIMIT=1_000_000_000_000n;
const AUTH=`EXISTS(SELECT 1 FROM shop_identity i
  JOIN shop_owner_write_grant g ON g.singleton=i.singleton
  WHERE i.singleton=1 AND i.shop_id=? AND i.database_id=? AND i.database_marker=?
    AND g.enabled=1 AND g.token_hash=?
    AND g.expires_at_ms>CAST(unixepoch('subsec') * 1000 AS INTEGER))`;
const CLEAN=`NOT EXISTS(SELECT 1 FROM legacy_product_snapshots)
  AND NOT EXISTS(SELECT 1 FROM products WHERE source_profile='canonical')
  AND NOT EXISTS(SELECT 1 FROM party_legacy_links)`;
const activeSupplier=`EXISTS(SELECT 1 FROM owner_supplier_master s
  JOIN parties p ON p.party_id=s.party_id AND p.status='ACTIVE'
  JOIN party_roles r ON r.party_id=s.party_id AND r.role='Supplier' AND r.status='ACTIVE'
  WHERE s.supplier_id=? AND s.status='Active')`;

const owner=(scope,token,subject)=>scope&&typeof scope.shopDb?.prepare==='function'&&
  typeof subject==='string'&&subject.trim()&&typeof token==='string';

function minor(value){
  const text=typeof value==='number'&&Number.isFinite(value)?String(value):value;
  if(typeof text!=='string'||!DECIMAL.test(text))return null;
  const [whole,frac='']=text.split('.');
  const result=BigInt(whole)*100n+BigInt(frac.padEnd(2,'0')||'0');
  return result<=LIMIT?result:null;
}
const zero=value=>minor(value??'0')===0n;
function micro(value){
  const text=typeof value==='number'&&Number.isFinite(value)?String(value):value;
  if(typeof text!=='string'||!QTY.test(text))return null;
  const [whole,frac='']=text.split('.');
  const result=BigInt(whole)*1000000n+BigInt(frac.padEnd(6,'0')||'0');
  return result>=1n&&result<=1_000_000_000n?result:null;
}
function dhakaDay(){return new Date(Date.now()+6*60*60*1000).toISOString().slice(0,10);}
const sourceId=(family,sequence)=>originalSourceIdPrefix(family)+'-'+String(sequence).padStart(6,'0');
const moneyValue=paisa=>Number(paisa)/100;
async function authority(scope,token){
  const digest=await hashOpaqueSessionToken(token);
  if(!digest)return null;
  return [scope.shopId,scope.databaseId,scope.databaseMarker,digest];
}
function cleanInput(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return {status:'invalid'};
  if(!zero(payload.discount)||!zero(payload.paidAmount)||
     (payload.backdatedReason&&String(payload.backdatedReason).trim())||
     (payload.date&&payload.date!==dhakaDay()))return {status:'unsupported'};
  if(!SUPPLIER.test(payload.supplierId||'')||!Array.isArray(payload.items)||
      payload.items.length<1||payload.items.length>50)return {status:'invalid'};
  if(payload.bankAccountId&&String(payload.bankAccountId).trim())return {status:'unsupported'};
  if(typeof payload.notes!=='string'||payload.notes.length>500||
    /[\u0000-\u001f\u007f]/.test(payload.notes))return {status:'invalid'};
  const items=[],seen=new Set();
  let subtotal=0n;
  for(const item of payload.items){
    if(!item||typeof item!=='object'||Array.isArray(item)||!PRODUCT.test(item.productId||''))return {status:'invalid'};
    if(item.unitBreakdown!=null||item.unitRevision!=null||item.tileMeasurement!=null)return {status:'unsupported'};
    if(seen.has(item.productId))return {status:'invalid'};
    seen.add(item.productId);
    const qty=micro(item.qty),cost=minor(item.unitPrice),sell=minor(item.sellingPrice);
    if(qty===null||cost===null||sell===null||cost>1_000_000_000n||sell>1_000_000_000n)return {status:'invalid'};
    const raw=qty*cost;
    if(raw%1_000_000n!==0n)return {status:'unsupported'};
    subtotal+=raw/1_000_000n;
    if(subtotal>LIMIT)return {status:'invalid'};
    items.push({productId:item.productId,qtyMicro:Number(qty),
      unitPricePaisa:Number(cost),sellPricePaisa:Number(sell),unitRevision:0});
  }
  if(subtotal<1n)return {status:'unsupported'};
  return {status:'ok',data:{items,notes:payload.notes,date:payload.date||dhakaDay()},
    supplierId:payload.supplierId,subtotal:Number(subtotal)};
}
function isPostingDenial(error){
  return /MVP_PURCHASE_LINE_INVALID|MVP_SUPPLIER_NOT_ACTIVE|MVP_NO_OPEN_CASH_SESSION|FOREIGN KEY constraint failed|CHECK constraint failed|UNIQUE constraint failed/i.test(String(error?.message||''));
}
function checkResult(results){
  if(!Array.isArray(results)||results.some(r=>r?.success!==true))
    throw new Error('Owner MVP write outcome unavailable');
}
function asActor(subject){return 'google:'+subject;}

export async function openOwnerCashSession(scope,{token,ownerSubject,operationId,openingCash,notes}={}){
  if(!OP.test(operationId||'')||typeof notes!=='string'||notes.length>250)return {status:'invalid'};
  const opening=minor(openingCash);
  if(opening===null)return {status:'invalid'};
  if(!owner(scope,token,ownerSubject))return {status:'denied'};
  const auth=await authority(scope,token);
  if(!auth)return {status:'denied'};
  const actorId=asActor(ownerSubject),DB=scope.shopDb;
  let rows;
  try{
    rows=await DB.batch([
      DB.prepare(`INSERT INTO owner_mvp_cash_sessions
        (operation_id,actor_id,status,opening_paisa,started_at_ms)
        SELECT ?,?,'Open',?,CAST(unixepoch('subsec')*1000 AS INTEGER)
        WHERE ${AUTH} AND (${CLEAN})
        AND NOT EXISTS(SELECT 1 FROM owner_mvp_cash_sessions WHERE status='Open')
        AND NOT EXISTS(SELECT 1 FROM owner_mvp_cash_sessions WHERE operation_id=?)
        RETURNING sequence`).bind(operationId,actorId,Number(opening),...auth,operationId),
      DB.prepare(`SELECT ${AUTH} AS allowed,
        (SELECT sequence FROM owner_mvp_cash_sessions WHERE status='Open') AS openSequence,
        (SELECT sequence FROM owner_mvp_cash_sessions WHERE operation_id=? AND actor_id=?) AS sameSequence
      `).bind(...auth,operationId,actorId),
    ]);
  }catch(error){
    if(/MVP_OPEN_CASH_MISMATCH|CHECK constraint failed/i.test(String(error?.message||'')))
      return {status:'opening-mismatch'};
    throw error;
  }
  checkResult(rows);
  const row=rows[1].results?.[0];
  if(row?.allowed!==1)return {status:'denied'};
  const seq=rows[0].results?.[0]?.sequence;
  if(Number.isSafeInteger(seq))return {status:'started',sessionId:sourceId('CASH_SESSIONS',seq)};
  if(Number.isSafeInteger(row.sameSequence))
    return {status:'replayed',sessionId:sourceId('CASH_SESSIONS',row.sameSequence)};
  if(Number.isSafeInteger(row.openSequence))
    return {status:'already-open',sessionId:sourceId('CASH_SESSIONS',row.openSequence)};
  return {status:'unavailable'};
}

/** Source Close Day: counted−persisted expected is an audit variance, never a fake Cash Book entry.
 * For 0006/0007 pilot Shops without reviewed 0009, retain zero-only Close behavior.
 * Under 0009, one SQL UPDATE atomically freezes closing counts against cash postings.
 */
export async function closeOwnerCashSession(scope,{token,ownerSubject,operationId,countedCash,notes}={}){
  if(!OP.test(operationId||'')||typeof notes!=='string'||notes.length>250||
      /[\\u0000-\\u001f\\u007f]/.test(notes))return {status:'invalid'};
  const counted=minor(countedCash);
  if(counted===null)return {status:'invalid'};
  if(!owner(scope,token,ownerSubject))return {status:'denied'};
  const auth=await authority(scope,token);
  if(!auth)return {status:'denied'};
  const DB=scope.shopDb,actorId=asActor(ownerSubject);
  const upgraded=await DB.prepare(`SELECT 1 AS present FROM pragma_table_info('owner_mvp_cash_sessions')
    WHERE name='close_intent_hash'`).first();
  if(!upgraded){
    // Pre-migration 0007 must continue refusing to close a posted Sale.
    if(counted!==0n)return {status:'unsupported'};
    let written,read;
    try{
      [written,read]=await DB.batch([
        DB.prepare(`UPDATE owner_mvp_cash_sessions SET status='Closed',
          closed_operation_id=?,closed_at_ms=CAST(unixepoch('subsec')*1000 AS INTEGER)
          WHERE status='Open' AND ${AUTH}
          RETURNING sequence`).bind(operationId,...auth),
        DB.prepare(`SELECT ${AUTH} AS allowed,
          (SELECT sequence FROM owner_mvp_cash_sessions
            WHERE closed_operation_id=?) AS closedSequence`).bind(...auth,operationId),
      ]);
    }catch(error){
      if(/MVP_CASH_RECONCILIATION_REQUIRED/.test(String(error?.message||'')))
        return {status:'reconciliation-required'};
      throw error;
    }
    checkResult([written,read]);
    if(read.results?.[0]?.allowed!==1)return {status:'denied'};
    const seq=written.results?.[0]?.sequence||read.results?.[0]?.closedSequence;
    if(!Number.isSafeInteger(seq))return {status:'session-required'};
    return {status:written.results.length?'closed':'replayed',
      sessionId:sourceId('CASH_SESSIONS',seq),variance:0};
  }

  // A completed close can be retried, but only by a still-authorized current
  // Owner with the same actor and canonical original count/note.
  const allowed=await DB.prepare(`SELECT ${AUTH} AS allowed`).bind(...auth).first();
  if(allowed?.allowed!==1)return {status:'denied'};
  const intent=await hashCanonicalOperationIntent({
    tenantId:scope.shopId,actorId,operationType:'cash.session.close.v1',
    payload:{countedPaisa:Number(counted),notes:notes.trim()}
  });
  const replay=await DB.prepare(`SELECT sequence,close_actor_id,close_intent_hash,
    expected_paisa,counted_paisa,variance_paisa
    FROM owner_mvp_cash_sessions WHERE closed_operation_id=?`).bind(operationId).first();
  function closeResult(row,status){
    return {status,sessionId:sourceId('CASH_SESSIONS',row.sequence),
      expected:moneyValue(row.expected_paisa),
      counted:moneyValue(row.counted_paisa),
      variance:moneyValue(row.variance_paisa)};
  }
  if(replay){
    if(replay.close_actor_id!==actorId||replay.close_intent_hash!==intent)
      return {status:'conflict'};
    return closeResult(replay,'replayed');
  }
  const expected=`(opening_paisa +
    COALESCE((SELECT SUM(b.received_paisa) FROM owner_mvp_sale_cash_book b
      WHERE b.cash_sequence=owner_mvp_cash_sessions.sequence),0) -
    COALESCE((SELECT SUM(r.debit_paisa) FROM owner_mvp_return_cash_book r
      WHERE r.cash_sequence=owner_mvp_cash_sessions.sequence),0))`;
  let written,read;
  try{
    [written,read]=await DB.batch([
      DB.prepare(`UPDATE owner_mvp_cash_sessions SET
        expected_paisa=${expected}, counted_paisa=?,
        variance_paisa=?-${expected}, close_intent_hash=?,close_actor_id=?,
        close_notes=?,closed_operation_id=?,
        closed_at_ms=CAST(unixepoch('subsec')*1000 AS INTEGER),
        status='Closed'
        WHERE status='Open' AND ${AUTH} AND (${CLEAN})
          AND NOT EXISTS(SELECT 1 FROM owner_mvp_cash_sessions
            WHERE closed_operation_id=?)
        RETURNING sequence,expected_paisa,counted_paisa,variance_paisa`).bind(
          Number(counted),Number(counted),intent,actorId,notes.trim(),operationId,
          ...auth,operationId),
      DB.prepare(`SELECT ${AUTH} AS allowed,
        (SELECT sequence FROM owner_mvp_cash_sessions WHERE status='Open') AS openSequence,
        s.sequence,s.close_actor_id,s.close_intent_hash,
        s.expected_paisa,s.counted_paisa,s.variance_paisa
        FROM (SELECT 1) x
        LEFT JOIN owner_mvp_cash_sessions s ON s.closed_operation_id=?`)
        .bind(...auth,operationId),
    ]);
  }catch(error){
    if(/MVP_CLOSE_|CHECK constraint failed|FOREIGN KEY constraint failed/i.test(String(error?.message||'')))
      return {status:'reconciliation-required'};
    throw error;
  }
  checkResult([written,read]);
  const row=read.results?.[0];
  if(row?.allowed!==1)return {status:'denied'};
  if(row.close_actor_id!==null&&row.close_actor_id!==undefined&&
     (row.close_actor_id!==actorId||row.close_intent_hash!==intent))
    return {status:'conflict'};
  if(!Number.isSafeInteger(row.sequence)){
    return {status:row.openSequence?'reconciliation-required':'session-required'};
  }
  if(row.close_intent_hash!==intent)return {status:'conflict'};
  return closeResult(row,written.results.length===1?'closed':'replayed');
}

/** Existing source-shaped Cash Session summary: opening+current session cash in−out. */
export async function readOwnerCashSession(DB){
  // 0006 Shops may lack Sale Cash Book; 0007 Shops may lack Return Book.
  const hasCash=await DB.prepare(`SELECT 1 AS present FROM sqlite_schema
    WHERE type='table' AND name='owner_mvp_sale_cash_book'`).first();
  const hasRefund=hasCash && await DB.prepare(`SELECT 1 AS present FROM sqlite_schema
    WHERE type='table' AND name='owner_mvp_return_cash_book'`).first();
  const row=hasRefund?await DB.prepare(`SELECT s.sequence,s.status,s.started_at_ms AS startedMs,
    s.opening_paisa AS openingPaisa,
    COALESCE((SELECT SUM(b.received_paisa) FROM owner_mvp_sale_cash_book b
      WHERE b.cash_sequence=s.sequence),0) AS inPaisa,
    COALESCE((SELECT SUM(r.debit_paisa) FROM owner_mvp_return_cash_book r
      WHERE r.cash_sequence=s.sequence),0) AS outPaisa
    FROM owner_mvp_cash_sessions s WHERE s.status='Open'
    ORDER BY s.sequence DESC LIMIT 1`).first():
    hasCash?await DB.prepare(`SELECT s.sequence,s.status,s.started_at_ms AS startedMs,
    s.opening_paisa AS openingPaisa,
    COALESCE((SELECT SUM(b.received_paisa) FROM owner_mvp_sale_cash_book b
      WHERE b.cash_sequence=s.sequence),0) AS inPaisa,
    0 AS outPaisa
    FROM owner_mvp_cash_sessions s WHERE s.status='Open'
    ORDER BY s.sequence DESC LIMIT 1`).first():
    await DB.prepare(`SELECT sequence,status,started_at_ms AS startedMs,
      opening_paisa AS openingPaisa,0 AS inPaisa,0 AS outPaisa
      FROM owner_mvp_cash_sessions WHERE status='Open'
      ORDER BY sequence DESC LIMIT 1`).first();
  return row?{
    sessionId:sourceId('CASH_SESSIONS',row.sequence),status:row.status,
    openedAt:new Date(row.startedMs).toISOString(),
    openingCash:moneyValue(row.openingPaisa),
    cashIn:moneyValue(row.inPaisa),cashOut:moneyValue(row.outPaisa),
    expectedCash:moneyValue(row.openingPaisa+row.inPaisa-row.outPaisa),
    countedCash:'',variance:0,notes:'',cashMismatch:null
  }:null;
}

/** Previous physical count for the next Start Day; does not start or alter a Session. */
export async function readOwnerCashOpeningSuggestion(DB){
  const supported=await DB.prepare(`SELECT 1 AS present FROM pragma_table_info('owner_mvp_cash_sessions')
    WHERE name='counted_paisa'`).first();
  if(!supported)return {openingCash:0};
  const last=await DB.prepare(`SELECT counted_paisa AS countedPaisa
    FROM owner_mvp_cash_sessions WHERE status='Closed'
    ORDER BY sequence DESC LIMIT 1`).first();
  return {openingCash:moneyValue(last?.countedPaisa??0)};
}

export async function postOwnerCreditPurchase(scope,{token,ownerSubject,operationId,payload}={}){
  if(!OP.test(operationId||''))return {status:'invalid'};
  const quote=cleanInput(payload);
  if(quote.status!=='ok')return quote;
  if(!owner(scope,token,ownerSubject))return {status:'denied'};
  const auth=await authority(scope,token);
  if(!auth)return {status:'denied'};
  const actorId=asActor(ownerSubject),DB=scope.shopDb;
  const intent=await hashCanonicalOperationIntent({
    tenantId:scope.shopId,actorId,operationType:'purchases.add.credit.v1',
    payload:{supplierId:quote.supplierId,subtotalPaisa:quote.subtotal,...quote.data}
  });
  const args=[operationId,actorId,intent,quote.supplierId,
    quote.data.date,JSON.stringify(quote.data),quote.subtotal];
  let rows;
  try{
    rows=await DB.batch([
      DB.prepare(`INSERT INTO owner_mvp_purchase_receipts
        (operation_id,actor_id,intent_hash,supplier_id,cash_sequence,purchase_date,
         payload,subtotal_paisa,created_at_ms)
        SELECT ?,?,?,?,s.sequence,?,?,?,CAST(unixepoch('subsec')*1000 AS INTEGER)
        FROM owner_mvp_cash_sessions s
        WHERE s.status='Open' AND ${AUTH} AND (${CLEAN})
          AND (${activeSupplier})
          AND NOT EXISTS(SELECT 1 FROM owner_mvp_purchase_receipts WHERE operation_id=?)
        RETURNING sequence`).bind(...args.slice(0,4),...args.slice(4),...auth,quote.supplierId,operationId),
      DB.prepare(`SELECT ${AUTH} AS allowed,
        (SELECT sequence FROM owner_mvp_cash_sessions WHERE status='Open') AS openSequence,
        (${activeSupplier}) AS supplierActive,
        r.sequence,r.actor_id,r.intent_hash,r.subtotal_paisa
        FROM (SELECT 1) context LEFT JOIN owner_mvp_purchase_receipts r
          ON r.operation_id=?`).bind(...auth,quote.supplierId,operationId),
    ]);
  }catch(error){
    if(isPostingDenial(error))return {status:'denied'};
    throw error;
  }
  checkResult(rows);
  const row=rows[1].results?.[0];
  if(row?.allowed!==1)return {status:'denied'};
  if(row.actor_id!==null&&row.actor_id!==undefined&&
     (row.actor_id!==actorId||row.intent_hash!==intent))return {status:'conflict'};
  if(!row.openSequence)return {status:'session-required'};
  if(row.supplierActive!==1)return {status:'denied'};
  if(!Number.isSafeInteger(row.sequence)||row.sequence<1)return {status:'denied'};
  if(row.actor_id!==actorId||row.intent_hash!==intent||row.subtotal_paisa!==quote.subtotal)
    return {status:'conflict'};
  return {status:rows[0].results.length===1?'created':'replayed',
    purchaseId:sourceId('PURCHASES',row.sequence),
    grandTotal:moneyValue(row.subtotal_paisa),dueAmount:moneyValue(row.subtotal_paisa)};
}

export async function readOwnerPurchaseBootstrap(DB){
  const rows=await DB.batch([
    DB.prepare(`SELECT p.product_id AS id,p.product_name AS name,p.brand_text AS brand,
      p.category_name AS category,p.base_unit_name AS unit,p.barcode_text AS barcode,
      p.purchase_price_text AS purchasePrice,p.selling_price_text AS sellingPrice,
      COALESCE(st.quantity_micro,0) AS stockMicro
      FROM products p LEFT JOIN owner_mvp_product_stock st ON st.product_id=p.product_id
      WHERE p.source_profile='new' AND p.is_deleted=0 AND p.status='Active'
      ORDER BY p.product_id LIMIT 1001`),
    DB.prepare(`SELECT s.supplier_id AS id,p.display_name AS name,p.phone,
      s.current_due_paisa AS duePaisa FROM owner_supplier_master s
      JOIN parties p ON p.party_id=s.party_id AND p.status='ACTIVE'
      JOIN party_roles r ON r.party_id=p.party_id AND r.role='Supplier' AND r.status='ACTIVE'
      WHERE s.status='Active' ORDER BY s.supplier_id LIMIT 1001`),
    DB.prepare(`SELECT category_id AS id,category_name AS name
      FROM product_categories WHERE status!='Inactive' LIMIT 1001`),
  ]);
  checkResult(rows);
  if(rows.some(x=>x.results.length>1000))throw new Error('MVP bootstrap exceeds checked limit');
  return {
    products:rows[0].results.map(x=>({
      id:x.id,name:x.name,brand:x.brand,category:x.category,
      unit:x.unit,barcode:x.barcode,
      purchasePrice:x.purchasePrice,sellingPrice:x.sellingPrice,
      stock:x.stockMicro/1_000_000
    })),
    suppliers:rows[1].results.map(x=>({
      id:x.id,name:x.name,phone:x.phone||'',currentDue:x.duePaisa/100
    })),
    categories:rows[2].results,bankAccounts:[],currencySymbol:''
  };
}

export async function readOwnerPurchaseHistory(DB){
  const result=await DB.prepare(`SELECT r.sequence,r.purchase_date AS date,
    s.supplier_id AS supplierId,p.display_name AS supplierName,
    r.subtotal_paisa AS grandPaisa
    FROM owner_mvp_purchase_receipts r
    JOIN owner_supplier_master s ON s.supplier_id=r.supplier_id
    JOIN parties p ON p.party_id=s.party_id
    JOIN owner_mvp_purchase_seals seal ON seal.purchase_sequence=r.sequence
    ORDER BY r.sequence DESC LIMIT 1001`).all();
  if(result?.success!==true||result.results.length>1000)
    throw new Error('MVP purchase history unavailable');
  return result.results.map(x=>({
    purchaseId:sourceId('PURCHASES',x.sequence),
    date:x.date,supplierId:x.supplierId,supplierName:x.supplierName,
    grandTotal:moneyValue(x.grandPaisa),paidAmount:0,
    dueAmount:moneyValue(x.grandPaisa),returnedAmount:0,
    paymentStatus:'Due',returnStatus:'No Return',
    editable:false,deletable:false
  }));
}

/** Original Purchase Management view contract backed by sealed D1 line rows. */
export async function readOwnerPurchaseDetail(DB,purchaseId){
  if(typeof purchaseId!=='string'||!/^PUR-[0-9]{6,}$/.test(purchaseId))return null;
  const seq=Number(purchaseId.slice(4));
  if(!Number.isSafeInteger(seq)||seq<1)return null;
  const [header,lines]=await DB.batch([
    DB.prepare(`SELECT r.sequence,r.purchase_date AS date,
      r.supplier_id AS supplierId,p.display_name AS supplierName,
      r.subtotal_paisa AS total,r.actor_id AS actorId,
      json_extract(r.payload,'$.notes') AS notes
      FROM owner_mvp_purchase_receipts r
      JOIN owner_supplier_master s ON s.supplier_id=r.supplier_id
      JOIN parties p ON p.party_id=s.party_id
      JOIN owner_mvp_purchase_seals seal ON seal.purchase_sequence=r.sequence
      WHERE r.sequence=?`).bind(seq),
    DB.prepare(`SELECT product_id AS productId,product_name AS name,
      quantity_micro AS qtyMicro,unit_cost_paisa AS unitCost,
      unit_sell_paisa AS unitSell,line_total_paisa AS lineTotal
      FROM owner_mvp_purchase_lines WHERE purchase_sequence=?
      ORDER BY line_number`).bind(seq),
  ]);
  checkResult([header,lines]);
  const row=header.results[0];
  if(!row)return null;
  return {
    purchaseId,date:row.date,supplierId:row.supplierId,
    supplierName:row.supplierName,subtotal:row.total/100,discount:0,
    grandTotal:row.total/100,paidAmount:0,dueAmount:row.total/100,
    paymentStatus:'Due',paymentMethod:'',bankAccountName:'',
    notes:row.notes||'',createdBy:row.actorId,returnedAmount:0,
    netPurchase:row.total/100,items:lines.results.map(l=>({
      productId:l.productId,name:l.name,qty:l.qtyMicro/1_000_000,
      unitPrice:l.unitCost/100,sellingPrice:l.unitSell/100,
      lineTotal:l.lineTotal/100,
    }))
  };
}
