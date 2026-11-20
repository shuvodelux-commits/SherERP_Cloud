/**
 * M06 MVP — SOURCE-SHAPED POS V2 -> nonposting, one-SKU M06 test intent.
 *
 * No privileged identity may come from this payload. Context MUST be built
 * from the current server-side Owner auth/Shop binding and a stable, trusted
 * checkout operation and invoice ID. This pure converter does NOT guarantee
 * stock, FIFO, unit revision, price authority, Cash Session or idempotency.
 * Do NOT import from any public/production Worker until the M03 single-writer
 * posting and M04 authorization gates are independently approved.
 */
import {normalizeSalePayments_,salePaymentPaisa_} from './sale-payments.js';

const CONTEXT_FIELDS=['tenantId','actorId','operationId','invoiceId'];
const SOURCE_FIELDS=['customerId','customerName','customerPhone','customerFatherName',
  'customerRelationType','customerAddress','items','discount'];
const SINGLE_FIELDS=[...SOURCE_FIELDS,'paymentType','paidAmount','paymentMethod','bankAccountId'];
const SPLIT_FIELDS=[...SOURCE_FIELDS,'payments'];
const ITEM_FIELDS=['productId','name','qty','unitPrice','priceMode','shortageResolution',
  'productType','bundleRevision'];
const PAYMENT_FIELDS=['id','method','amount','accountId'];
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const OP_ID=/^[A-Za-z0-9_-]{12,100}$/;
const MONEY=/^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,2})?$/;
const MAX_PAISA=1_000_000_000;
const METHODS=new Set(['Cash','Bank','Mobile Banking']);

function plain(input,allowed,{required=allowed}={}){
  if(input===null||typeof input!=='object'||Array.isArray(input)||
     ![Object.prototype,null].includes(Object.getPrototypeOf(input)))
    throw new TypeError('Expected plain source record');
  const seen=new Set();
  for(const key of Reflect.ownKeys(input)){
    const desc=Object.getOwnPropertyDescriptor(input,key);
    if(typeof key!=='string'||!allowed.includes(key)||!desc?.enumerable||
       !Object.hasOwn(desc,'value'))
      throw new TypeError('Unexpected source field or accessor');
    seen.add(key);
  }
  if(required.some(key=>!seen.has(key)))throw new TypeError('Missing required source field');
}

function money(value,label){
  if(typeof value!=='string'&&typeof value!=='number')
    throw new TypeError('Canonical '+label+' money required');
  if(typeof value==='number'&&!Number.isFinite(value))
    throw new TypeError('Canonical '+label+' money required');
  const raw=String(value);
  if(!MONEY.test(raw))throw new TypeError('Canonical '+label+' money requires at most two decimals');
  const cents=salePaymentPaisa_(raw,label,false);
  if(cents>MAX_PAISA)throw new RangeError(label+' money exceeds MVP limit');
  return cents;
}
const fixed=cents=>String(Math.floor(cents/100))+'.'+String(cents%100).padStart(2,'0');
function trustedContext(context){
  plain(context,CONTEXT_FIELDS);
  const {tenantId,actorId,invoiceId,operationId}=context;
  if(![tenantId,actorId,invoiceId].every(v=>typeof v==='string'&&ID.test(v))||
     typeof operationId!=='string'||!OP_ID.test(operationId))
    throw new TypeError('Invalid trusted Shop/actor/operation context');
  return {tenantId,actorId,invoiceId,operationId};
}
function trustedAccounts(accountRows){
  if(!Array.isArray(accountRows)||accountRows.length>100)
    throw new TypeError('Current trusted payment account list required');
  const ids=new Set();
  for(const row of accountRows){
    plain(row,['Bank Account ID','Account Name','Account Type','Status','Is Deleted'],
      {required:['Bank Account ID','Account Type','Status']});
    const id=row['Bank Account ID'];
    if(typeof id!=='string'||!ID.test(id)||ids.has(id)||
       !METHODS.has(row['Account Type'])||row['Account Type']==='Cash'||
       !['Active','Inactive'].includes(row.Status)||
       (row['Is Deleted']!==undefined&&!['TRUE','FALSE'].includes(row['Is Deleted'])))
      throw new TypeError('Invalid or duplicate trusted payment account');
    ids.add(id);
  }
  return accountRows;
}
/**
 * The original POS default is auto price + 'negative' shortage even for a
 * completely in-stock product. Never interpret that label as permission to
 * oversell. A trusted tuple must come from CURRENT server-side Product/FIFO
 * revision and owned-stock evidence, not from the client checkout payload.
 * The final D1 posting write must recheck both stock and pricing atomically.
 */
function checkTrustedSaleLine(trustedProduct,line,unitPrice,subtotal){
  plain(trustedProduct,['productId','effectiveUnitPrice','effectiveLineTotal','availableUnits']);
  if(typeof trustedProduct.productId!=='string'||
     trustedProduct.productId!==line.productId||
     !Number.isSafeInteger(trustedProduct.availableUnits)||
     trustedProduct.availableUnits<0||
     trustedProduct.availableUnits<line.qty)
    throw new TypeError('Trusted current product stock is unavailable or insufficient');
  if(typeof trustedProduct.effectiveUnitPrice!=='string'||
     typeof trustedProduct.effectiveLineTotal!=='string')
    throw new TypeError('Trusted current product price and FIFO total required');
  const serverPrice=money(trustedProduct.effectiveUnitPrice,'trusted price');
  const serverTotal=money(trustedProduct.effectiveLineTotal,'trusted FIFO line total');
  if(line.priceMode==='auto'&&(unitPrice!==serverPrice||subtotal!==serverTotal))
    throw new TypeError('Trusted current FIFO price or line total mismatch');
}
function sourceLine(items,trustedProduct){
  if(!Array.isArray(items)||items.length!==1)
    throw new TypeError('Unsupported MVP sale: single standard product only');
  const line=items[0];
  plain(line,ITEM_FIELDS);
  if(line.productType!=='Standard'||line.bundleRevision!==0||
     !['manual','auto'].includes(line.priceMode)||
     !['own','negative'].includes(line.shortageResolution))
    throw new TypeError('Unsupported product type, price mode or source shortage mode');
  if(typeof line.productId!=='string'||!ID.test(line.productId)||
     typeof line.name!=='string'||line.name.length>180||
     !Number.isSafeInteger(line.qty)||line.qty<1||line.qty>1_000_000)
    throw new TypeError('Invalid standard product identity or quantity');
  const unitPrice=money(line.unitPrice,'unit price');
  const subtotal=unitPrice*line.qty;
  if(!Number.isSafeInteger(subtotal)||subtotal>MAX_PAISA)
    throw new RangeError('MVP sale subtotal exceeds supported money limit');
  if(line.priceMode==='auto'||line.shortageResolution==='negative'||
     trustedProduct!==undefined)
    checkTrustedSaleLine(trustedProduct,line,unitPrice,subtotal);
  return {sku:line.productId,units:line.qty,unitPrice,subtotal};
}
function checkSourceIdentity(payload){
  for(const key of ['customerId','customerName','customerPhone','customerFatherName',
    'customerRelationType','customerAddress']){
    if(typeof payload[key]!=='string'||payload[key].length>250||
       /[\u0000-\u001f\u007f]/.test(payload[key]))
      throw new TypeError('Invalid source customer field');
  }
  if(payload.customerId&&!ID.test(payload.customerId))
    throw new TypeError('Invalid source Customer ID');
  return payload.customerId;
}
function splitRows(rows){
  if(!Array.isArray(rows)||rows.length>20)
    throw new TypeError('Unsupported split-payment row count');
  return rows.map(row=>{
    plain(row,PAYMENT_FIELDS);
    if(typeof row.id!=='string'||!ID.test(row.id)||
       !METHODS.has(row.method)||typeof row.accountId!=='string')
      throw new TypeError('Invalid split-payment row identity or method');
    return {id:row.id,method:row.method,
      amount:fixed(money(row.amount,'payment')),accountId:row.accountId};
  });
}
function singleRows(payload,grand){
  if(!['Cash','Due','Partial'].includes(payload.paymentType)||
     !METHODS.has(payload.paymentMethod)||
     typeof payload.bankAccountId!=='string')
    throw new TypeError('Invalid source payment type or method');
  const paid=money(payload.paidAmount,'paid');
  if(payload.paymentType==='Cash' && paid!==grand ||
     payload.paymentType==='Due' && paid!==0 ||
     payload.paymentType==='Partial' && (paid<=0||paid>=grand))
    throw new TypeError('Source payment total and payment type mismatch');
  if(paid===0){
    if(payload.bankAccountId)throw new TypeError('Unpaid invoice cannot select a payment account');
    return [];
  }
  const method=payload.paymentMethod;
  if(method==='Cash'&&payload.bankAccountId||
     method!=='Cash'&&!payload.bankAccountId)
    throw new TypeError('Payment account does not match chosen method');
  return [{
    id:'single-payment',method,amount:fixed(paid),accountId:payload.bankAccountId,
  }];
}

/**
 * Translate exactly the one-SKU subset of original POS V2. No DB writes.
 * Fail closed for multiple product lines, draft/update, offers, sourcing and
 * noncanonical money rather than silently changing posted accounting.
 *
 * The existing M06 isolated posting proof also enforces live stock, bank,
 * customer due, Cash Session, replay/hash and child-transaction invariants.
 */
export function normalizeMvpPosV2SaleIntent({context,payload,accountRows,trustedProduct}={}){
  const scope=trustedContext(context);
  plain(payload,[...new Set([...SINGLE_FIELDS,...SPLIT_FIELDS,'operationId'])],
    {required:SOURCE_FIELDS});
  const hasSplit=Object.hasOwn(payload,'payments');
  const required=hasSplit?SPLIT_FIELDS:SINGLE_FIELDS;
  plain(payload,hasSplit?[...SPLIT_FIELDS,'operationId']:[...SINGLE_FIELDS,'operationId'],
    {required});
  if(Object.hasOwn(payload,'operationId')&&payload.operationId!==scope.operationId)
    throw new TypeError('Browser operation ID does not match trusted context');
  const {sku,units,unitPrice,subtotal}=sourceLine(payload.items,trustedProduct);
  const discount=money(payload.discount,'discount');
  if(discount>subtotal)throw new TypeError('Discount exceeds original sale subtotal');
  const grand=subtotal-discount;
  if(grand<1)throw new TypeError('Zero-value sale needs a separately reviewed contract');
  const customerId=checkSourceIdentity(payload);
  trustedAccounts(accountRows);
  const rows=hasSplit?splitRows(payload.payments):singleRows(payload,grand);
  const allocation=normalizeSalePayments_(fixed(grand),rows,accountRows);
  const paid=salePaymentPaisa_(allocation.paidAmount,'Paid amount',false);
  const due=salePaymentPaisa_(allocation.dueAmount,'Due amount',false);
  if(paid+due!==grand)throw new Error('Nonconserving POS payment');
  if(due>0&&!customerId)throw new TypeError('Customer is required for an unpaid or partially due sale');
  return Object.freeze({
    ...scope,sku,units,unitPrice:fixed(unitPrice),discount:fixed(discount),customerId,
    payments:Object.freeze(rows.map(row=>Object.freeze(row))),
  });
}
