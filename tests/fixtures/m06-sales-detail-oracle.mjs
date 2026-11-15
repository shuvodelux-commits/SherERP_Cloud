import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {pinnedPostedInvoice} from './m06-posted-invoice-oracle.mjs';

// Test-only frozen native GAS. No imports from target Sales detail module.
const originals={
  'SalesManagement.gs':'43afb640bfe46962c3715fa8a2ee08ab3fdda1aa',
  'Utils.gs':'dd893411263fbf72a32616a3b8434bf74fb08350'
};
const clone=value=>structuredClone(value);
function originalFile(name,hash){
  const bytes=readFileSync(new URL('../../legacy/source/'+name,import.meta.url));
  const actual=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
  if(actual!==hash)throw new Error('Frozen M06 Sales source changed: '+name);
  return bytes.toString('utf8');
}
function namedFunction(source,name){
  const start=source.indexOf('function '+name+'(');
  if(start<0)throw new Error('Frozen native function unavailable: '+name);
  const end=source.indexOf('\n}',start);
  if(end<0)throw new Error('Frozen native function not complete: '+name);
  return source.slice(start,end+2);
}
export function createNativeSalesDetailOracle(){
  const sales=originalFile('SalesManagement.gs',originals['SalesManagement.gs']);
  const utils=originalFile('Utils.gs',originals['Utils.gs']);
  const functions=[
    namedFunction(sales,'getSaleDetail'),
    namedFunction(sales,'canViewInvoiceProfit_'),
    namedFunction(sales,'buildSalesInvoiceProfitMetrics_'),
    namedFunction(utils,'economicReturnLineAmount_'),
    namedFunction(utils,'roundMoney_'),
    namedFunction(utils,'isValidNonNegativeNumber_')
  ];
  return Object.freeze({
    project(invoiceId,sourceSnapshot,{canViewSales,canViewProfit}={}){
      const snapshot=clone(sourceSnapshot);
      const base=pinnedPostedInvoice({
        invoiceId,sales:snapshot.sales,items:snapshot.items,
        products:snapshot.products,customers:snapshot.customers,
        paymentRows:snapshot.paymentRows,settings:snapshot.settings,
        settlement:snapshot.settlement
      });
      base.shop=clone(snapshot.shop);
      const context=vm.createContext({
        requirePermission_(_token,module,action){
          if(module!=='sales'||action!=='view'||canViewSales!==true)
            throw new Error('Permission denied: sales.view');
          return {actorId:'TRUSTED-ACTOR'};
        },
        hasPermission_(_user,module,action){
          return canViewProfit===true && module==='reports' && action==='view';
        },
        buildInvoicePayload_:()=>clone(base),
        activeSalesReturnItems_:()=>snapshot.returnItems,
        getAllRows_(key){
          const map={
            SALE_ITEMS:snapshot.items,SALE_BUNDLE_COMPONENTS:snapshot.bundleComponents,
            SALE_ITEM_LOTS:snapshot.saleItemLots
          };
          if(!Object.hasOwn(map,key))throw new Error('Unexpected source table '+key);
          return map[key];
        },
        activeRows_(key){
          if(key!=='VENDOR_SOURCING')throw new Error('Unexpected source active table '+key);
          return snapshot.vendorSourcing.filter(r=>String(r['Is Deleted']||'').toUpperCase()!=='TRUE');
        },
        findUniqueSalesRow_:id=>{
          const rows=snapshot.sales.filter(r=>String(r['Invoice ID'])===id);
          if(rows.length>1)throw new Error('Duplicate invoice ID detected: '+id);
          return rows[0]||null;
        },
        ok_:data=>({success:true,data}),
        fail_:message=>({success:false,message}),
        logError_:()=>{}
      });
      for(const fn of functions)vm.runInContext(fn,context,{timeout:1000});
      context.__id=invoiceId;
      const result=vm.runInContext('getSaleDetail("trusted-token",__id)',context,{timeout:1000});
      if(!result.success)throw new Error(String(result.message));
      return clone(result.data);
    }
  });
}
