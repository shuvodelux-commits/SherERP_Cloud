import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createContext,runInContext} from 'node:vm';

/**
 * Executes frozen original GAS functions in a test-only VM.
 * Never imports target runtime modules to synthesize source expectations.
 */
const hashes={
  'SalesManagement.gs':'43afb640bfe46962c3715fa8a2ee08ab3fdda1aa',
  'SalePayments.gs':'dd08b0c1e27a799c9c16feda50239f172eb7eb4f',
  'Utils.gs':'dd893411263fbf72a32616a3b8434bf74fb08350'
};
function pinned(name,expected){
  const bytes=readFileSync(new URL('../../legacy/source/'+name,import.meta.url));
  const hash=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
  if(hash!==expected)throw new Error('Frozen source drift for '+name);
  return bytes.toString('utf8');
}
function namedFunction(source,name){
  const start=source.indexOf('function '+name+'(');
  if(start<0)throw new Error('Original source function not found: '+name);
  const end=source.indexOf('\n}',start);
  if(end<0)throw new Error('Original function lacks end brace: '+name);
  return source.slice(start,end+2);
}
export function createNativeSplitUpdateOracle(){
  const sources=Object.fromEntries(Object.entries(hashes)
    .map(([name,sha])=>[name,pinned(name,sha)]));
  const ctx=createContext({});
  for(const [source,name] of [
    ['Utils.gs','roundMoney_'],
    ['Utils.gs','isValidNonNegativeNumber_'],
    ['SalesManagement.gs','saleUpdateLineTotal_'],
    ['SalePayments.gs','salePaymentPaisa_'],
    ['SalePayments.gs','normalizeSalePayments_']
  ])runInContext(namedFunction(sources[source],name),ctx,{filename:source,timeout:1000});

  return Object.freeze({
    project(snapshot){
      const input=structuredClone(snapshot);
      const oldByProduct=new Map();
      for(const old of input.oldItems){
        if(old['Invoice ID']!==input.invoiceId)continue;
        if(!oldByProduct.has(old['Product ID']))
          oldByProduct.set(old['Product ID'],old);
      }
      let subtotal=0;
      const lines=[];
      const seen=new Set();
      for(const item of input.newItems){
        if(seen.has(item.productId))throw new Error('Duplicate edit item');
        seen.add(item.productId);
        ctx.__old=oldByProduct.get(item.productId);
        ctx.__qty=Number(item.qty);
        ctx.__price=Number(item.unitPrice);
        const lineTotal=runInContext('saleUpdateLineTotal_(__old,__qty,__price)',ctx,{timeout:1000});
        subtotal=runInContext('roundMoney_(__subtotal + __lineTotal)',Object.assign(ctx,{
          __subtotal:subtotal,__lineTotal:lineTotal
        }),{timeout:1000});
        lines.push({productId:item.productId,qty:ctx.__qty,unitPrice:ctx.__price,lineTotal});
      }
      ctx.__discount=input.discount;
      const discount=runInContext('isValidNonNegativeNumber_(__discount) ? Number(__discount) : 0',ctx,{timeout:1000});
      const grandTotal=Math.max(0,subtotal-discount);
      ctx.__grandTotal=grandTotal;
      ctx.__payments=input.payments;
      ctx.__bankAccounts=input.bankAccounts;
      const allocation=runInContext(
        'normalizeSalePayments_(roundMoney_(__grandTotal),__payments,__bankAccounts)',
        ctx,{timeout:1000});
      return JSON.parse(JSON.stringify({
        invoiceId:input.invoiceId,subtotal,discount,grandTotal,lines,allocation
      }));
    }
  });
}
