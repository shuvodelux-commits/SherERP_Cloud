import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

/** Test-only, pinned native GAS oracle. NEVER import this into production. */
const references={
  'SalesManagement.gs':'43afb640bfe46962c3715fa8a2ee08ab3fdda1aa',
  'Bundles.gs':'64b13f733ea2fc857cba59816945ccb2bce7327a',
  'SalePayments.gs':'dd08b0c1e27a799c9c16feda50239f172eb7eb4f',
  'CashSession.gs':'4a3b40a475757a2faa9ea6a0b99bd9aebb2c6735',
  'Utils.gs':'dd893411263fbf72a32616a3b8434bf74fb08350'
};
const sources=()=>Object.fromEntries(Object.entries(references).map(([filename,expected])=>{
  const file=readFileSync(new URL('../../legacy/source/'+filename,import.meta.url));
  const actual=createHash('sha1').update('blob '+file.length+'\0').update(file).digest('hex');
  if(actual!==expected)throw new Error('Frozen source changed: '+filename);
  return [filename,file.toString('utf8')];
}));
function sourceFunction(text,name){
  const start=text.indexOf('function '+name+'(');
  if(start<0)throw new Error('Missing frozen GAS function: '+name);
  const end=text.indexOf('\n}',start);
  if(end<0)throw new Error('Incomplete frozen GAS function: '+name);
  return text.slice(start,end+2);
}
const copy=value=>structuredClone(value);
const dateFormat=(value,timeZone,pattern)=>{
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))throw new Error('Invalid source Date');
  const format=new Intl.DateTimeFormat('en-US',{
    timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',
    minute:'2-digit',second:'2-digit',hourCycle:'h23'
  });
  const parts=Object.fromEntries(format.formatToParts(date).map(p=>[p.type,p.value]));
  if(pattern==='yyyy-MM-dd')return parts.year+'-'+parts.month+'-'+parts.day;
  if(pattern==='HH:mm:ss')return parts.hour+':'+parts.minute+':'+parts.second;
  throw new Error('Unexpected source Date format');
};

export function createNativeSaleUpdateOracle(){
  const files=sources();
  const funcs=[
    ['SalesManagement.gs','getSaleForUpdate'],
    ['Bundles.gs','getSaleBundleSnapshot_'],
    ['SalePayments.gs','salePaymentPaisa_'],
    ['SalePayments.gs','readSalePaymentBreakdown_'],
    ['CashSession.gs','findSessionForTimestamp_'],
    ['Utils.gs','formatDate_'],
    ['Utils.gs','safeDateOnly_'],
    ['Utils.gs','safeTimeOnly_'],
    ['Utils.gs','roundMoney_'],
    ['Utils.gs','isValidNonNegativeNumber_']
  ];
  return Object.freeze({
    project(invoiceId,snapshot,{canEditSales}={}){
      const input=copy(snapshot);
      const lists={
        SALES:input.sales, SALE_ITEMS:input.items, SALE_PAYMENTS:input.paymentRows,
        CASH_SESSIONS:input.sessions, SALE_BUNDLE_COMPONENTS:input.bundleComponents,
        VENDOR_SOURCING:input.vendorSourcing
      };
      const context=vm.createContext({
        Utilities:{formatDate:dateFormat},
        Session:{getScriptTimeZone:()=> 'Asia/Dhaka'},
        requirePermission_(_token,module,action){
          if(module!=='sales' || action!=='edit' || !canEditSales)throw new Error('Permission denied: sales.edit');
        },
        getAllRows_(key){
          if(!Object.hasOwn(lists,key))throw new Error('Unknown source snapshot '+key);
          return lists[key];
        },
        findRows_(key,column,value){return lists[key].filter(r=>String(r[column])===String(value));},
        findUniqueSalesRow_(id){
          const matches=lists.SALES.filter(r=>String(r['Invoice ID'])===String(id));
          if(matches.length>1)throw new Error('Duplicate invoice ID detected: '+id);
          return matches[0]||null;
        },
        isDeleted_:row=>String(row['Is Deleted']||'').toUpperCase()==='TRUE',
        activeSalesReturnItems_:()=>input.returnItems,
        ok_:data=>({success:true,data}),
        fail_:message=>({success:false,message}),
        logError_:()=>{}
      });
      for(const [file,name] of funcs){
        vm.runInContext(sourceFunction(files[file],name),context,{filename:file,timeout:1000});
      }
      context.__invoiceId=invoiceId;
      const result=vm.runInContext('getSaleForUpdate("test-token",__invoiceId)',context,{
        filename:'SalesManagement.gs::getSaleForUpdate',timeout:1000
      });
      if(!result.success)throw new Error(String(result.message));
      return copy(result.data);
    }
  });
}
