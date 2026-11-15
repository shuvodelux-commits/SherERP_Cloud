import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

/** Test-only oracle. Execute the frozen GAS getSalesManagementList, never a target rewrite. */
const originals={
  'SalesManagement.gs':'43afb640bfe46962c3715fa8a2ee08ab3fdda1aa',
  'Utils.gs':'dd893411263fbf72a32616a3b8434bf74fb08350',
  'CashSession.gs':'4a3b40a475757a2faa9ea6a0b99bd9aebb2c6735'
};
const clone=value=>structuredClone(value);
function nativeSource(filename,sha){
  const file=readFileSync(new URL('../../legacy/source/'+filename,import.meta.url));
  const actual=createHash('sha1').update('blob '+file.length+'\0').update(file).digest('hex');
  if(actual!==sha)throw new Error('Frozen Sales list source mismatch: '+filename);
  return file.toString('utf8');
}
function sourceFunction(code,name){
  const at=code.indexOf('function '+name+'(');
  if(at<0)throw new Error('Frozen Sales list helper not found: '+name);
  const end=code.indexOf('\n}',at);
  if(end<0)throw new Error('Unclosed frozen function: '+name);
  return code.slice(at,end+2);
}
const dateFormat=(value,tz,pattern)=>{
  if(pattern!=='yyyy-MM-dd')throw new Error('Unexpected GAS date format: '+pattern);
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))throw new Error('Invalid native date');
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(date);
  const part=t=>parts.find(x=>x.type===t)?.value;
  return part('year')+'-'+part('month')+'-'+part('day');
};

export function createNativeSalesListOracle(){
  const source=Object.fromEntries(Object.entries(originals).map(([name,sha])=>
    [name,nativeSource(name,sha)]));
  const funcs=[
    ['SalesManagement.gs','getSalesManagementList'],
    ['SalesManagement.gs','canViewInvoiceProfit_'],
    ['SalesManagement.gs','buildSalesInvoiceProfitMetrics_'],
    ['Utils.gs','duplicateSalesInvoiceIdMap_'],
    ['Utils.gs','economicReturnLineAmount_'],
    ['Utils.gs','roundMoney_'],
    ['Utils.gs','isValidNonNegativeNumber_'],
    ['Utils.gs','formatDate_'],
    ['Utils.gs','safeDateOnly_'],
    ['Utils.gs','safeTimeOnly_'],
    ['CashSession.gs','findSessionForTimestamp_']
  ];
  return Object.freeze({
    project(snapshot,{canViewSales,canViewProfit}={}){
      const input=clone(snapshot);
      const data={
        SALES:input.sales, SALE_ITEMS:input.items,
        CASH_SESSIONS:input.sessions, CUSTOMER_LEDGER:[],
        SALE_BUNDLE_COMPONENTS:input.bundleComponents,
        SALE_ITEM_LOTS:input.saleItemLots,
        SALES_RETURN:[]
      };
      const active=row=>String(row['Is Deleted']||'').toUpperCase()!=='TRUE';
      const scope=vm.createContext({
        Utilities:{formatDate:dateFormat},
        Session:{getScriptTimeZone:()=> 'Asia/Dhaka'},
        requirePermission_(_token,module,operation){
          if(module!=='sales'||operation!=='view'||canViewSales!==true)
            throw new Error('Permission denied: sales.view');
          return {id:'server-auth-actor'};
        },
        hasPermission_(_user,area,operation){
          return canViewProfit===true && area==='reports'&&operation==='view';
        },
        activeRows_(table){
          if(table==='VENDOR_SOURCING')return input.vendorSourcing.filter(active);
          if(table==='SALES')return input.sales.filter(active);
          if(table==='SALES_RETURN')return [];
          throw new Error('Unknown GAS active group: '+table);
        },
        getAllRows_(table){
          if(!Object.hasOwn(data,table))throw new Error('Unknown GAS table: '+table);
          return data[table];
        },
        activeSalesReturnItems_:()=>input.returnItems,
        customerSettlementState_:customerId=>({customerId,byInvoice:input.settlementsByInvoice}),
        customerInvoiceSettlementSnapshotFromState_:(row,state)=>
          state.byInvoice[String(row['Invoice ID'])]||null,
        ok_:value=>({success:true,data:value}),
        fail_:message=>({success:false,message}),
        logError_:()=>{}
      });
      for(const [filename,name] of funcs){
        vm.runInContext(sourceFunction(source[filename],name),scope,{filename,timeout:1000});
      }
      const result=vm.runInContext('getSalesManagementList("server-token")',scope,{
        filename:'SalesManagement.gs::getSalesManagementList',timeout:1000
      });
      if(!result.success)throw new Error(String(result.message));
      return clone(result.data);
    }
  });
}
