import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createContext,runInContext} from 'node:vm';

/** Independently executes pinned native GAS money helpers. Test-only. */
const frozen={
  'SalesManagement.gs':'43afb640bfe46962c3715fa8a2ee08ab3fdda1aa',
  'Utils.gs':'dd893411263fbf72a32616a3b8434bf74fb08350'
};
function readPinned(name,sha){
  const data=readFileSync(new URL('../../legacy/source/'+name,import.meta.url));
  const actual=createHash('sha1').update('blob '+data.length+'\\0'.replace('\\0','\0'))
    .update(data).digest('hex');
  if(actual!==sha)throw new Error('Original source unexpectedly changed: '+name);
  return data.toString('utf8');
}
function namedFunction(source,name){
  const from=source.indexOf('function '+name+'(');
  if(from<0)throw new Error('Missing original function: '+name);
  const end=source.indexOf('\n}',from);
  if(end<0)throw new Error('Incomplete original function: '+name);
  return source.slice(from,end+2);
}
export function createNativeSaleLineTotalOracle(){
  const files=Object.fromEntries(Object.entries(frozen).map(([name,sha])=>[name,readPinned(name,sha)]));
  const context=createContext({});
  for(const [name,file] of [
    ['isValidNonNegativeNumber_','Utils.gs'],
    ['roundMoney_','Utils.gs'],
    ['saleUpdateLineTotal_','SalesManagement.gs']
  ])runInContext(namedFunction(files[file],name),context,{timeout:1000});
  const evalSource=(expression,values)=>{
    for(const [key,value] of Object.entries(values))context[key]=structuredClone(value);
    return runInContext(expression,context,{timeout:1000});
  };
  return Object.freeze({
    sourceLineTotal(oldItem,newQty,newUnitPrice){
      return evalSource('saleUpdateLineTotal_(__old,__qty,__price)',{
        __old:oldItem,__qty:newQty,__price:newUnitPrice
      });
    },
    sourceRoundMoney(value){
      return evalSource('roundMoney_(__money)',{__money:value});
    },
    sourcePlan(invoiceId,oldItems,newItems){
      const oldByKey=new Map();
      for(const row of oldItems){
        if(row['Invoice ID']!==invoiceId)continue;
        if(!oldByKey.has(row['Product ID']))oldByKey.set(row['Product ID'],row);
      }
      let subtotal=0;
      const lines=[];
      for(const item of newItems){
        const qty=Number(item.qty),unitPrice=Number(item.unitPrice);
        const lineTotal=this.sourceLineTotal(oldByKey.get(item.productId),qty,unitPrice);
        lines.push({productId:item.productId,qty,unitPrice,lineTotal});
        subtotal=this.sourceRoundMoney(subtotal+lineTotal);
      }
      return {subtotal,lines};
    }
  });
}
