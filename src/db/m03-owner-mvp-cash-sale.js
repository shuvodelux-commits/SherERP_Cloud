/**
 * M03 MVP: ORIGINAL Owner POS -> real, SQL-atomic, one-lot, cash-paid Sale.
 * The feature is explicitly gated by the private Owner Worker; never
 * install as a public RPC. A preflight quote is NOT a financial authorization:
 * all Owner/Shop lease, FIFO lot, price, stock and Cash Session guards repeat
 * in the SAME D1 SQL INSERT which triggers the Cash and stock movements.
 *
 * Deliberate pilot limits: one Standard SKU, whole units, oldest lot alone
 * covers the order, auto price matches that lot, no discount, no Customer Due,
 * no Bank, split payment, bundle, vendor, Tiles, draft or edit.
 */
import {pilotShopIdentityMatches} from '../auth/platform-shop-binding.js';
import {hashOpaqueSessionToken} from '../auth/session-token.js';
import {hashCanonicalOperationIntent} from './operation-intent-fingerprint.js';
import {normalizeMvpPosV2SaleIntent} from '../modules/mvp-pos-v2-sale-intent.js';
import {projectSalesManagementList} from '../modules/sales-management-list-read.js';
import {readOwnerCashSession} from './m03-owner-mvp-purchase.js';

const OP=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SKU=/^PRD-[0-9]{6,}$/;
const CASH_PILOT=/^\d+(?:\.\d{1,2})?$/;
const NOW="CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const AUTH=`EXISTS(SELECT 1 FROM shop_identity i
  JOIN shop_owner_write_grant g ON g.singleton=i.singleton
  WHERE i.singleton=1 AND i.shop_id=? AND i.database_id=? AND i.database_marker=?
  AND g.enabled=1 AND g.token_hash=? AND g.expires_at_ms>${NOW})`;
const CLEAN=`NOT EXISTS(SELECT 1 FROM legacy_product_snapshots)
  AND NOT EXISTS(SELECT 1 FROM products WHERE source_profile='canonical')
  AND NOT EXISTS(SELECT 1 FROM party_legacy_links)`;
const format=paisa=>`${Math.floor(paisa/100)}.${String(paisa%100).padStart(2,'0')}`;
const money=paisa=>Number(paisa)/100;

function parsePaisa(value){
  const x=typeof value==='number'&&Number.isFinite(value)?String(value):value;
  if(typeof x!=='string'||!CASH_PILOT.test(x)||x.length>14)return null;
  const [a,b='']=x.split('.');
  const n=Number(a)*100+Number(b.padEnd(2,'0')||'0');
  return Number.isSafeInteger(n)&&n>=0&&n<=1_000_000_000_000?n:null;
}
function plain(value){
  return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
    [Object.prototype,null].includes(Object.getPrototypeOf(value));
}
function cleanText(value,limit,{required=false}={}){
  if(typeof value!=='string'||value.length>limit||/[\u0000-\u001f\u007f]/.test(value))return null;
  const text=value.trim();
  return required&&!text?null:text;
}
function validInput(raw){
  if(!plain(raw)||Object.keys(raw).length>15)return {status:'invalid'};
  const expected=['customerId','customerName','customerPhone','customerFatherName',
    'customerRelationType','customerAddress','items','discount',
    'paymentType','paidAmount','paymentMethod','bankAccountId','operationId'];
  if(Object.keys(raw).some(k=>!expected.includes(k)))return {status:'unsupported'};
  if(!Array.isArray(raw.items)||raw.items.length!==1)return {status:'unsupported'};
  const line=raw.items[0];
  if(!plain(line)||Object.keys(line).some(k=>![
    'productId','name','qty','unitPrice','priceMode','shortageResolution',
    'bundleRevision','productType'].includes(k)))return {status:'unsupported'};
  if(!SKU.test(line.productId||'')||!Number.isSafeInteger(line.qty)||
     line.qty<1||line.qty>1000)return {status:'invalid'};
  if(line.priceMode!=='auto'||!['negative','own'].includes(line.shortageResolution)||
     line.productType!=='Standard'||line.bundleRevision!==0)return {status:'unsupported'};
  const cents=parsePaisa(line.unitPrice),paid=parsePaisa(raw.paidAmount);
  if(cents===null||cents<1||paid===null)return {status:'invalid'};
  if(raw.customerId!==''||raw.paymentType!=='Cash'||raw.paymentMethod!=='Cash'||
     raw.bankAccountId!==''||parsePaisa(raw.discount)!==0)return {status:'unsupported'};
  if(paid!==line.qty*cents)return {status:'unsupported'};
  const fields=[
    cleanText(raw.customerName,180,{required:true}),
    cleanText(raw.customerPhone,60,{required:true}),
    cleanText(raw.customerFatherName,180),
    cleanText(raw.customerRelationType,50),
    cleanText(raw.customerAddress,250),
  ];
  if(fields.some(x=>x===null))return {status:'invalid'};
  return {status:'ok',line,cents,paid,customer:fields};
}
async function currentAuthority(scope,token){
  if(!scope||typeof scope.shopDb?.prepare!=='function'||!await pilotShopIdentityMatches(scope))
    return null;
  const tokenHash=await hashOpaqueSessionToken(token);
  if(!tokenHash)return null;
  const bindings=[scope.shopId,scope.databaseId,scope.databaseMarker,tokenHash];
  const DB=scope.shopDb;
  const row=await DB.prepare(`SELECT ${AUTH} AS allowed`).bind(...bindings).first();
  return row?.allowed===1?bindings:null;
}
async function currentLot(DB,sku){
  return DB.prepare(`SELECT l.sequence,l.qty_micro,pl.unit_sell_paisa,p.product_name,
    p.base_unit_name,s.quantity_micro AS stock_micro
    FROM owner_mvp_stock_lots l
    JOIN owner_mvp_purchase_lines pl ON pl.purchase_sequence=l.purchase_sequence
       AND pl.line_number=l.line_number
    JOIN products p ON p.product_id=l.product_id
    JOIN owner_mvp_product_stock s ON s.product_id=p.product_id
    WHERE l.product_id=? AND l.qty_micro>0
      AND p.source_profile='new' AND p.status='Active' AND p.is_deleted=0
      AND p.product_type_text='Standard' AND p.current_unit_revision=0
      AND pl.unit_revision=0
    ORDER BY l.purchased_on,l.sequence LIMIT 1`).bind(sku).first();
}
const sourceId=seq=>'INV-'+String(seq).padStart(6,'0');
function invoiceDate(ms){
  return new Date(ms+6*3600*1000).toISOString();
}
/** Read only an immutable, completely posted original source-shaped invoice. */
export async function readOwnerCashSaleInvoice(DB,invoiceId){
  if(typeof invoiceId!=='string'||!/^INV-[0-9]{6,}$/.test(invoiceId))return null;
  const seq=Number(invoiceId.slice(4));
  if(!Number.isSafeInteger(seq)||seq<1)return null;
  const row=await DB.prepare(`SELECT r.*,b.received_paisa
    FROM owner_mvp_sale_receipts r
    JOIN owner_mvp_sale_cash_book b ON b.sale_sequence=r.sequence
    JOIN owner_mvp_sale_fifo_draws d ON d.sale_sequence=r.sequence
       AND d.lot_sequence=r.lot_sequence AND d.quantity_micro=r.quantity_micro
    WHERE r.sequence=?`).bind(seq).first();
  if(!row||row.received_paisa!==row.subtotal_paisa)return null;
  return projectOwnerCashInvoice(row);
}

function projectOwnerCashInvoice(row){
  const when=invoiceDate(row.created_at_ms);
  const total=money(row.subtotal_paisa);
  return {
    invoiceId:sourceId(row.sequence),date:when.slice(0,10),time:when.slice(11,19),
    dueDate:'',customerId:'',customerName:row.customer_name,customerPhone:row.customer_phone,
    customerFatherName:row.customer_father_name,customerRelationType:row.customer_relation_type,
    customerAddress:row.customer_address,
    items:[{productId:row.product_id,name:row.product_name,
      qty:row.quantity_micro/1_000_000,unit:row.unit_name,
      unitPrice:money(row.unit_price_paisa),lineTotal:total,
      supplierId:'',supplierName:''}],
    subtotal:total,discount:0,grandTotal:total,paidAmount:total,dueAmount:0,
    customerCreditUsed:0,paymentType:'Cash',paymentStatus:'Paid',
    originalPaidAmount:total,paymentDetailVersion:'',payments:[],
    paymentMethod:'Cash',bankAccountId:'',bankAccountName:'',
    shop:{name:row.shop_name,nameBangla:'',proprietorName:'',proprietorParagraph:'',
      invoiceTitle:'চালান',description:'',address:'',phone1:'',phone2:'',phone:'',
      logoDataUri:'',showBismillah:false,bismillahText:'',showSignature:false,
      paymentMethods:'[]',terms:'[]',paymentTermsText:'',
      currencySymbol:'',footer:'',receiptSize:'80mm'}
  };
}

// The pilot schema stores immutable cash sales and append-only cash returns.
const SALES_HISTORY_TABLES=[
  'owner_mvp_sale_receipts','owner_mvp_sale_cash_book','owner_mvp_sale_fifo_draws',
  'owner_mvp_sale_return_receipts','owner_mvp_return_cash_book','owner_mvp_return_stock_movements',
];

export async function ownerSalesSchemaReady(db){
  const columns=SALES_HISTORY_TABLES.map(()=>'?').join(',');
  const row=await db.prepare(`SELECT COUNT(*) AS present FROM sqlite_schema
    WHERE type='table' AND name IN (${columns})`).bind(...SALES_HISTORY_TABLES).first();
  return row?.present===SALES_HISTORY_TABLES.length;
}

export function ownerInvoiceSequence(invoiceId){
  if(typeof invoiceId!=='string'||!/^INV-[0-9]{6,16}$/.test(invoiceId))return null;
  const sequence=Number(invoiceId.slice(4));
  return Number.isSafeInteger(sequence)&&sequence>0&&sourceId(sequence)===invoiceId?sequence:null;
}

/** The caller must authorize the current Owner and verify the Shop identity. */
export async function readOwnerSalesManagement(db,sequence=null){
  const {success,results}=await db.prepare(`SELECT r.*,b.received_paisa,d.unit_cost_paisa,
    COALESCE((SELECT SUM(ret.quantity_micro) FROM owner_mvp_sale_return_receipts ret
      WHERE ret.sale_sequence=r.sequence),0) AS returned_micro,
    COALESCE((SELECT SUM(ret.total_paisa) FROM owner_mvp_sale_return_receipts ret
      WHERE ret.sale_sequence=r.sequence),0) AS returned_paisa,
    EXISTS(SELECT 1 FROM owner_mvp_sale_return_receipts ret
      LEFT JOIN owner_mvp_return_cash_book refund ON refund.return_sequence=ret.sequence
        AND refund.debit_paisa=ret.total_paisa AND refund.cash_sequence=ret.cash_sequence
      LEFT JOIN owner_mvp_return_stock_movements restock ON restock.return_sequence=ret.sequence
        AND restock.quantity_micro=ret.quantity_micro AND restock.lot_sequence=r.lot_sequence
        AND restock.product_id=r.product_id
      WHERE ret.sale_sequence=r.sequence AND
        (refund.return_sequence IS NULL OR restock.return_sequence IS NULL)) AS incomplete_return
    FROM owner_mvp_sale_receipts r
    LEFT JOIN owner_mvp_sale_cash_book b ON b.sale_sequence=r.sequence AND b.cash_sequence=r.cash_sequence
    LEFT JOIN owner_mvp_sale_fifo_draws d ON d.sale_sequence=r.sequence
      AND d.lot_sequence=r.lot_sequence AND d.quantity_micro=r.quantity_micro
    WHERE r.sequence BETWEEN ? AND ?
    ORDER BY r.created_at_ms DESC,r.sequence DESC`)
    .bind(sequence??1,sequence??Number.MAX_SAFE_INTEGER).all();
  if(!success)throw Error('Sales history read failed');
  const projected=results.map(row=>{
    const netPaisa=row.subtotal_paisa-row.returned_paisa;
    const netQty=(row.quantity_micro-row.returned_micro)/1_000_000;
    const costComplete=Number.isSafeInteger(row.unit_cost_paisa*netQty);
    if(row.received_paisa!==row.subtotal_paisa||row.unit_cost_paisa===null||
       row.incomplete_return||netPaisa<0||netQty<0||!costComplete)
      throw Error('Sales history needs reconciliation');
    const invoice=projectOwnerCashInvoice(row);
    const id={'Invoice ID':invoice.invoiceId,'Product ID':row.product_id};
    const [summary]=projectSalesManagementList({
      sales:[{'Invoice ID':invoice.invoiceId,'Date':invoice.date,'Time':invoice.time,
        'Created At':new Date(row.created_at_ms).toISOString(),
        'Customer ID':invoice.customerId,'Customer Name':invoice.customerName,'Customer Phone':invoice.customerPhone,
        'Subtotal':invoice.subtotal,'Grand Total':invoice.grandTotal,'Paid Amount':invoice.paidAmount,
        'Due Amount':invoice.dueAmount,'Payment Status':invoice.paymentStatus}],
      items:[{...id,'Quantity':row.quantity_micro/1_000_000}],
      returnItems:row.returned_micro?[{...id,'Return Quantity':row.returned_micro/1_000_000,
        'Line Total':money(row.returned_paisa),'Pricing Basis':'NetAfterInvoiceDiscount'}]:[],
      sessions:[],bundleComponents:[],vendorSourcing:[],settlementsByInvoice:{},
      saleItemLots:[{...id,'Quantity':netQty,'Unit Cost':money(row.unit_cost_paisa)}],
    },{canViewSales:true,canViewProfit:true});
    summary.netSale=money(netPaisa);
    summary.profit=money(netPaisa-row.unit_cost_paisa*netQty);
    if(sequence===null)return summary;
    const {returnedAmount,netSale,profit,profitMarginPercent,profitCostComplete,returnStatus}=summary;
    return {...invoice,returnedAmount,netSale,profit,profitMarginPercent,profitCostComplete,returnStatus,editable:false};
  });
  return sequence===null?projected:projected[0]??null;
}

export async function readOwnerPosBootstrap(DB,{shopName}={}){
  if(typeof shopName!=='string'||!shopName.trim())throw new TypeError('Verified shop name required');
  const [products,lots]=await DB.batch([
    DB.prepare(`SELECT p.product_id AS id,p.product_name AS name,
      p.brand_text AS brand,p.category_name AS category,p.base_unit_name AS unit,
      p.barcode_text AS barcode,p.selling_price_text AS sellingPrice,
      COALESCE(st.quantity_micro,0) AS stockMicro
      FROM products p LEFT JOIN owner_mvp_product_stock st ON st.product_id=p.product_id
      WHERE p.source_profile='new' AND p.is_deleted=0 AND p.status='Active'
      AND p.product_type_text='Standard' AND p.current_unit_revision=0
      ORDER BY p.product_id LIMIT 1001`),
    DB.prepare(`SELECT l.product_id AS productId,l.qty_micro AS qtyMicro,
      pl.unit_sell_paisa AS sellPaisa
      FROM owner_mvp_stock_lots l JOIN owner_mvp_purchase_lines pl
      ON pl.purchase_sequence=l.purchase_sequence AND pl.line_number=l.line_number
      WHERE l.qty_micro>0 ORDER BY l.product_id,l.purchased_on,l.sequence LIMIT 5001`),
  ]);
  if(products?.success!==true||lots?.success!==true||
     products.results.length>1000||lots.results.length>5000)
    throw new Error('Incomplete POS stock snapshot');
  const groups=new Map();
  for(const row of lots.results){
    const segments=groups.get(row.productId)||[];
    if(row.qtyMicro>0 && row.sellPaisa>=0){
      const qty=row.qtyMicro/1_000_000,sellPrice=money(row.sellPaisa);
      const prev=segments[segments.length-1];
      if(prev?.sellPrice===sellPrice)prev.qty+=qty;
      else segments.push({qty,sellPrice});
    }
    groups.set(row.productId,segments);
  }
  const productsOut=products.results.map(p=>{
    const listed=Number(p.sellingPrice);
    if(!Number.isFinite(listed)||listed<0)throw new Error('POS product price unavailable');
    const segments=groups.get(p.id)||[];
    const fallback=listed;
    return {id:p.id,name:p.name,brand:p.brand||'',unit:p.unit,
      barcode:p.barcode||'',category:p.category||'',productType:'Standard',
      bundleRevision:0,sellingPrice:listed,lotPricing:segments,
      fallbackSellPrice:fallback,autoSellingPrice:segments[0]?.sellPrice??fallback,
      stock:p.stockMicro/1_000_000};
  });
  const cash=await readOwnerCashSession(DB);
  return {
    products:productsOut,showPurchasePrice:false,canViewCurrentInvoiceProfit:false,
    multiPaymentEnabled:false,customers:[],vendors:[],vendorsAll:[],bankAccounts:[],
    activeSession:cash?{'Session ID':cash.sessionId,Status:cash.status}:null,
    shopName,currencySymbol:'',taxPercent:0,
  };
}

/** Actual financial mutation: all effects inside one guarded INSERT+triggers. */
export async function postOwnerCashSale(scope,{token,ownerSubject,operationId,payload,shopName}={}){
  if(typeof operationId!=='string'||!OP.test(operationId))return {status:'invalid'};
  if(typeof ownerSubject!=='string'||!ownerSubject.trim())return {status:'denied'};
  const authorized=await currentAuthority(scope,token);
  if(!authorized)return {status:'denied'};
  const quote=validInput(payload);
  if(quote.status!=='ok')return quote;
  const shop=cleanText(shopName,180,{required:true});
  if(!shop)return {status:'invalid'};
  const actorId='google:'+ownerSubject,DB=scope.shopDb;
  const intent=await hashCanonicalOperationIntent({
    tenantId:scope.shopId,actorId,operationType:'sales.add.cash.v1',
    payload:{checkoutJson:JSON.stringify(payload)},
  });
  // Stable replay BEFORE preflight prevents retried receipts from failing
  // after their own committed stock/price/cash effects have changed.
  const existing=await DB.prepare(`SELECT sequence,actor_id,intent_hash
    FROM owner_mvp_sale_receipts WHERE operation_id=?`).bind(operationId).first();
  if(existing){
    if(existing.actor_id!==actorId||existing.intent_hash!==intent)return {status:'conflict'};
    const invoice=await readOwnerCashSaleInvoice(DB,sourceId(existing.sequence));
    return invoice?{status:'replayed',invoice}:{status:'unavailable'};
  }
  const cash=await readOwnerCashSession(DB);
  if(!cash)return {status:'session-required'};
  const {line,cents,paid,customer}=quote;
  const lot=await currentLot(DB,line.productId);
  if(!lot||lot.qty_micro<line.qty*1_000_000||lot.stock_micro<line.qty*1_000_000)
    return {status:'declined'};
  // Preflight only. The INSERT below rechecks live FIFO/stock/price/role.
  if(lot.unit_sell_paisa!==cents)return {status:'unsupported'};
  try{
    normalizeMvpPosV2SaleIntent({
      context:{tenantId:scope.shopId,actorId,invoiceId:'INV-CANDIDATE',operationId},
      payload,accountRows:[],
      trustedProduct:{productId:line.productId,effectiveUnitPrice:format(lot.unit_sell_paisa),
        effectiveLineTotal:format(line.qty*lot.unit_sell_paisa),
        availableUnits:Math.floor(Math.min(lot.qty_micro,lot.stock_micro)/1_000_000)},
    });
  }catch{return {status:'unsupported'};}
  let responses;
  try{
    responses=await DB.batch([
      DB.prepare(`INSERT INTO owner_mvp_sale_receipts
        (operation_id,actor_id,intent_hash,cash_sequence,lot_sequence,
         product_id,product_name,unit_name,quantity_micro,unit_price_paisa,
         subtotal_paisa,customer_name,customer_phone,customer_father_name,
         customer_relation_type,customer_address,shop_name,created_at_ms)
        SELECT ?,?,?,s.sequence,l.sequence,p.product_id,p.product_name,p.base_unit_name,
          ?,?,?,?,?,?,?,?, ?,${NOW}
        FROM owner_mvp_cash_sessions s
        JOIN owner_mvp_stock_lots l ON l.sequence=?
        JOIN owner_mvp_purchase_lines pl ON pl.purchase_sequence=l.purchase_sequence
          AND pl.line_number=l.line_number
        JOIN products p ON p.product_id=l.product_id
        JOIN owner_mvp_product_stock st ON st.product_id=p.product_id
        WHERE s.status='Open' AND l.qty_micro>=? AND st.quantity_micro>=?
          AND pl.unit_sell_paisa=? AND p.source_profile='new'
          AND p.status='Active' AND p.is_deleted=0
          AND p.product_type_text='Standard' AND p.current_unit_revision=0
          AND l.sequence=(SELECT sequence FROM owner_mvp_stock_lots
            WHERE product_id=p.product_id AND qty_micro>0
            ORDER BY purchased_on,sequence LIMIT 1)
          AND ${AUTH} AND (${CLEAN})
          AND NOT EXISTS(SELECT 1 FROM owner_mvp_sale_receipts WHERE operation_id=?)
        RETURNING sequence`).bind(
          operationId,actorId,intent,
          line.qty*1_000_000,cents,paid,...customer,shop,
          lot.sequence,line.qty*1_000_000,line.qty*1_000_000,cents,
          ...authorized,operationId),
      DB.prepare(`SELECT ${AUTH} AS allowed,
        (SELECT sequence FROM owner_mvp_cash_sessions WHERE status='Open') AS openSequence,
        r.sequence,r.actor_id,r.intent_hash
        FROM (SELECT 1) context LEFT JOIN owner_mvp_sale_receipts r
          ON r.operation_id=?`).bind(...authorized,operationId),
    ]);
  }catch(error){
    if(/MVP_SALE_STALE_STOCK_OR_PRICE|MVP_SALE_CASH_SESSION_REQUIRED|FOREIGN KEY|CHECK constraint|UNIQUE constraint/i.test(String(error?.message||'')))
      return {status:'declined'};
    throw error;
  }
  if(responses.some(r=>r?.success!==true))throw new Error('Unverified POS D1 mutation');
  const [written,verified]=responses;
  const state=verified.results?.[0];
  if(state?.allowed!==1)return {status:'denied'};
  if(state.actor_id!==null&&state.actor_id!==undefined&&
     (state.actor_id!==actorId||state.intent_hash!==intent))return {status:'conflict'};
  if(!state.openSequence)return {status:'session-required'};
  if(!Number.isSafeInteger(state.sequence)||state.sequence<1)return {status:'declined'};
  const invoice=await readOwnerCashSaleInvoice(DB,sourceId(state.sequence));
  if(!invoice)return {status:'unavailable'};
  return {status:written.results.length===1?'created':'replayed',invoice};
}
