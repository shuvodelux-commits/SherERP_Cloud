/**
 * M06 INTERNAL-ONLY POS checkout preview — mixed-unit sales + split payments.
 *
 * Original sale/payment truth: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * Approved multi-unit source: sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c
 * Reuses reviewed M06 line planner and byte-preserved SalePayments.gs helper.
 *
 * This is NOT authenticated POS, Cash Session authorization, D1 read/write,
 * stock reservation, Party/Bank/Cash posting, RPC, invoice generation or
 * production checkout. M03's sole integrator must eventually recheck the
 * tenant, M04 actor, M05 unit history and atomic financial write boundary.
 */
import {planMultiUnitPosLine} from './m06-multi-unit-pos-line.js';
import {salePaymentPaisa_,normalizeSalePayments_} from './sale-payments.js';

function plain(row){
  if(!row || typeof row!=='object' || Array.isArray(row))return false;
  const proto=Object.getPrototypeOf(row);
  return (proto===Object.prototype || proto===null) &&
    Object.values(Object.getOwnPropertyDescriptors(row))
      .every(d=>Object.hasOwn(d,'value'));
}
function rows(value,label){
  if(!Array.isArray(value))throw new TypeError('Missing trusted '+label+' snapshot.');
  for(const row of value){
    if(!plain(row))throw new TypeError('Invalid trusted '+label+' record or accessor.');
  }
}

/**
 * Pure display-only checkout intent, not an authoritative write validation.
 * Caller MUST have already loaded all tenant-authoritative source snapshots
 * with M04-authenticated POS rights, and future D1 posting MUST revalidate.
 */
export function planMultiUnitPosCheckoutPreview(intent,snapshot){
  if(!plain(intent) || !Array.isArray(intent.lines) ||
     intent.lines.length===0 || !Array.isArray(intent.payments)){
    throw new TypeError('A trusted, nonempty POS checkout cart and payments are required.');
  }
  if(!plain(snapshot))throw new TypeError('Missing trusted POS checkout snapshot.');
  rows(snapshot.products,'POS products');
  rows(snapshot.conversionRows,'POS conversions');
  rows(snapshot.stockLots,'POS stock lots');
  rows(snapshot.bankAccounts,'POS bank accounts');
  rows(intent.lines,'POS checkout lines');
  rows(intent.payments,'POS payment rows');

  const accountIds=new Set();
  for(const account of snapshot.bankAccounts){
    const id=account['Bank Account ID'];
    if(typeof id!=='string'||!id.trim()){
      throw new Error('NEEDS_REVIEW: invalid POS Bank Account ID in trusted snapshot.');
    }
    if(accountIds.has(id)){
      throw new Error('NEEDS_REVIEW: duplicate POS Bank Account ID in trusted snapshot.');
    }
    accountIds.add(id);
  }

  const products=new Set(),lines=[];
  let subtotalPaisa=0;
  for(const line of intent.lines){
    if(typeof line.productId!=='string'||!line.productId.trim()){
      throw new TypeError('POS checkout line requires an exact Product ID.');
    }
    if(products.has(line.productId)){
      throw new Error('NEEDS_REVIEW: duplicate POS Product ID; use one logical sale line.');
    }
    products.add(line.productId);
    if(!Array.isArray(line.unitBreakdown)){
      throw new TypeError('POS checkout line unit breakdown is required.');
    }
    rows(line.unitBreakdown,'POS unit breakdown');
    const planned=planMultiUnitPosLine(line,{
      products:snapshot.products,conversionRows:snapshot.conversionRows,
      stockLots:snapshot.stockLots
    });
    const linePaisa=salePaymentPaisa_(planned.lineTotal,'Sale line total',false);
    subtotalPaisa+=linePaisa;
    if(!Number.isSafeInteger(subtotalPaisa)){
      throw new RangeError('NEEDS_REVIEW: POS checkout subtotal exceeds exact-money limit.');
    }
    lines.push(planned);
  }

  const discountPaisa=salePaymentPaisa_(intent.discount,'Discount',true);
  const grandPaisa=Math.max(0,subtotalPaisa-discountPaisa);
  if(!Number.isSafeInteger(grandPaisa)){
    throw new RangeError('NEEDS_REVIEW: POS checkout Grand Total exceeds exact-money limit.');
  }

  const subtotal=subtotalPaisa/100;
  const discount=discountPaisa/100;
  const grandTotal=grandPaisa/100;
  const allocation=normalizeSalePayments_(
    grandTotal,intent.payments,snapshot.bankAccounts);
  return {lines,subtotal,discount,grandTotal,allocation};
}
