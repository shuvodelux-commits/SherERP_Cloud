/**
 * M06 PRIVATE POS V2 unified checkout display proposal.
 *
 * The frozen original pos.html is still the operational UI (POS V2 is a
 * presentation controller). This adapter combines one Standard/mixed-unit
 * cart and current Tile revision quotes WITHOUT adding a public RPC, D1
 * writer, inventory reservation, invoice, draft or authorization boundary.
 *
 * Original sale/payment source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * Approved optional units: sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c
 * Future M03 integration must authenticate M04 actor+tenant and re-plan all
 * stock/price/session/Party/amount claims inside the approved atomic writer.
 */
import {planMultiUnitPosLine} from './m06-multi-unit-pos-line.js';
import {previewTileSaleLineCandidateD1} from './m06-tile-sale-line-preview.js';
import {salePaymentPaisa_,normalizeSalePayments_} from './sale-payments.js';

const MAX_MINOR=BigInt(Number.MAX_SAFE_INTEGER);
const DIGITS=/^(?:0|[1-9][0-9]*)$/u;
const LINE_FIELDS={
  Standard:['kind','productId','claimedBaseQty','shortageMode','unitBreakdown'],
  Tile:['kind','productId','request']
};
const REQUEST_FIELDS=['mode','boxes','extraPieces','requestedSqft','fulfillment'];

function record(value,allowed,label){
  if(!value||typeof value!=='object'||Array.isArray(value)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(value)))
    throw new TypeError('Invalid trusted '+label+' record');
  for(const field of Reflect.ownKeys(value)){
    const descriptor=Object.getOwnPropertyDescriptor(value,field);
    if(typeof field!=='string'||!descriptor||!descriptor.enumerable||
       !Object.hasOwn(descriptor,'value')||
       (allowed&&!allowed.includes(field)))
      throw new TypeError('Unsupported or accessor-backed '+label+' field');
  }
}
function rows(value,label,allowed=null){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)
    throw new TypeError('Invalid trusted '+label+' list');
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Object.values(descriptors).some(d=>!Object.hasOwn(d,'value'))||
     Array.from({length:value.length},(_,i)=>Object.hasOwn(value,i)).some(x=>!x))
    throw new TypeError('Invalid trusted '+label+' accessor or sparse list');
  for(const row of value)record(row,allowed,label+' row');
}
const id=value=>typeof value==='string'&&value.trim()===value&&
  value.length>0&&value.length<=256&&!/[\u0000-\u001f\u007f]/u.test(value);
const quantity=value=>(typeof value==='number'&&Number.isFinite(value))||
  (typeof value==='string'&&value.trim()!==''&&
   /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value));
const fmt=value=>String(value);
const positiveParts=parts=>parts.filter(part=>Number(part.qty)>0)
  .map(part=>fmt(part.qty)+' '+part.name);
function minor(value,label){
  if(typeof value!=='string'||!DIGITS.test(value))throw new TypeError('Invalid exact '+label+' minor amount');
  const out=BigInt(value);
  if(out>MAX_MINOR)throw new RangeError('NEEDS_REVIEW: '+label+' money out of range');
  return out;
}
function add(a,b){
  const sum=a+b;
  if(sum>MAX_MINOR)throw new RangeError('NEEDS_REVIEW: POS cart money out of range');
  return sum;
}

function standardDisplay(line,trusted){
  const planned=planMultiUnitPosLine(line,{
    products:trusted.products,conversionRows:trusted.conversionRows,
    stockLots:trusted.stockLots
  });
  // The original POS V2 provides one cart row per product. Do not invent
  // child sale lines or derive money from the rounded effective unitPrice.
  const name=trusted.products.filter(x=>
    String(x['Product ID']||'')===line.productId&&
    String(x['Is Deleted']||'').toUpperCase()!=='TRUE'
  )[0]['Product Name']||'';
  const parts=planned.unitBreakdownSnapshot.length
    ?planned.unitBreakdownSnapshot.map(x=>({qty:x.qty,name:x.unitName}))
    :[{qty:planned.baseQty,name:planned.stockUnit}];
  const lineAmountMinor=String(salePaymentPaisa_(planned.lineTotal,'POS line total',false));
  return {
    kind:'Standard',productId:planned.productId,productName:String(name),
    quantityLabel:positiveParts(parts).join(' + '),
    baseQty:planned.baseQty,stockUnit:planned.stockUnit,
    shortageMode:planned.shortageMode,
    lineAmountMinor,lineTotal:planned.lineTotal,
    unitPrice:planned.unitPrice,
    unitBreakdownSnapshot:planned.unitBreakdownSnapshot.map(x=>({...x})),
    unitPricingSnapshot:planned.unitPricingSnapshot.map(x=>({...x})),
    stockAuthority:'not-loaded',postingAllowed:false
  };
}

async function tileDisplay(line,trusted){
  if(!trusted.DB||typeof trusted.DB.prepare!=='function')
    throw new TypeError('Missing trusted private Tile D1 binding');
  const quote=await previewTileSaleLineCandidateD1({
    DB:trusted.DB,productId:line.productId,
    revision:'current',request:line.request
  });
  if(!quote||quote.productId!==line.productId||
     quote.stockAuthority!=='not-loaded'||quote.salePreview?.postingAllowed!==false)
    throw new Error('NEEDS_REVIEW: current Tile quote unavailable');
  const q=quote.quantity,p=quote.salePreview;
  const amount=minor(p.lineAmountMinor,'Tile line');
  const parts=positiveParts([
    {qty:q.boxes,name:q.measurementSnapshot.boxUnitName},
    {qty:q.extraPieces,name:'Pcs'}
  ]);
  return {
    kind:'Tile',productId:quote.productId,productName:quote.productName,
    quantityLabel:parts.join(' + ')+' · '+q.displaySqft+' Sqft',
    baseQty:Number(q.pieces),stockUnit:'Pcs',tileRevision:quote.revision,
    boxes:q.boxes,extraPieces:q.extraPieces,actualSqft:{...q.actualSqft},
    displaySqft:q.displaySqft,requestedSqft:q.requestedSqft
      ?{...q.requestedSqft}:null,
    measurementSnapshot:{...q.measurementSnapshot},
    requestSnapshot:{...q.requestSnapshot},
    priceSnapshot:{...p.priceSnapshot},
    lineAmountMinor:String(amount),lineTotal:Number(amount)/100,
    stockAuthority:'not-loaded',postingAllowed:false
  };
}

/**
 * Combine a POS V2 display-only cart. Every Standard quantity/price/factor
 * comes from the trusted snapshot, every Tile from the approved M03 reader.
 * This result NEVER grants a sale, draft or invoice posting permission.
 *
 * @param {{lines:Array,discount:string,payments:Array}} intent
 * @param {{products:Array,conversionRows:Array,stockLots:Array,bankAccounts:Array,DB?:object}} snapshot
 */
export async function previewPosV2UnifiedCartCandidateD1(intent,snapshot){
  record(intent,['lines','discount','payments'],'POS V2 cart intent');
  record(snapshot,['products','conversionRows','stockLots','bankAccounts','DB'],
    'POS V2 source snapshot');
  rows(intent.lines,'POS V2 cart line');
  rows(intent.payments,'POS V2 payment',['id','method','accountId','amount']);
  rows(snapshot.products,'POS source product');
  rows(snapshot.conversionRows,'POS source conversion');
  rows(snapshot.stockLots,'POS source lot');
  rows(snapshot.bankAccounts,'POS source bank account');

  if(intent.lines.length===0||intent.lines.length>100)
    throw new TypeError('Invalid empty or oversized POS V2 cart');
  const usedIds=new Set(),lines=[];
  let subtotalMinor=0n;

  for(const input of intent.lines){
    if(!LINE_FIELDS[input.kind])throw new TypeError('Unsupported POS V2 cart line kind');
    record(input,LINE_FIELDS[input.kind],'POS V2 '+input.kind+' line');
    if(!id(input.productId))throw new TypeError('Invalid POS V2 Product ID');
    if(usedIds.has(input.productId))
      throw new Error('NEEDS_REVIEW: duplicate Product ID in POS V2 cart');
    usedIds.add(input.productId);

    if(input.kind==='Standard'){
      if(!quantity(input.claimedBaseQty))
        throw new TypeError('Invalid POS V2 base quantity');
      rows(input.unitBreakdown,'POS V2 unit component',['conversionId','qty']);
      for(const unit of input.unitBreakdown){
        if(!id(unit.conversionId)||!quantity(unit.qty))
          throw new TypeError('Invalid POS V2 unit quantity');
      }
    }else{
      record(input.request,REQUEST_FIELDS,'POS V2 Tile request');
    }

    const out=input.kind==='Standard'
      ?standardDisplay(input,snapshot)
      :await tileDisplay(input,snapshot);
    subtotalMinor=add(subtotalMinor,minor(out.lineAmountMinor,'POS V2 line'));
    lines.push(out);
  }
  const discountMinor=BigInt(salePaymentPaisa_(intent.discount,'Discount',true));
  const grandMinor=subtotalMinor>discountMinor?subtotalMinor-discountMinor:0n;
  const subtotal=Number(subtotalMinor)/100;
  const discount=Number(discountMinor)/100;
  const grandTotal=Number(grandMinor)/100;
  const allocation=normalizeSalePayments_(
    grandTotal,intent.payments,snapshot.bankAccounts
  );
  return {
    lines,subtotal,discount,grandTotal,allocation,
    stockAuthority:'not-loaded',postingAllowed:false
  };
}
