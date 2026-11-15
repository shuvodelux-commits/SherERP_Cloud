import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// M06 test-only source oracle; not a Worker import or permission enforcement.
// Full original source is frozen by the 84-file source manifest.
const utils=readFileSync(new URL('../../legacy/source/Utils.gs',import.meta.url),'utf8');
const invoice=readFileSync(new URL('../../legacy/source/Invoice.gs',import.meta.url),'utf8');
const copy=x=>JSON.parse(JSON.stringify(x));

export function nativePosPhoneHistory({activeSales=[],settlementByInvoice={},ledgerRows=[],returnRows=[]}={}) {
  const reads=[];
  const context={
    CONFIG:{APP_NAME:'SherERP'},
    Session:{getScriptTimeZone:()=> 'Asia/Dhaka'},
    Utilities:{formatDate(date,tz,fmt){
      if(fmt!=='yyyy-MM-dd')throw new Error('Unexpected format: '+fmt);
      return new Date(date).toISOString().slice(0,10);
    }},
    requirePermission_(token,mod,action){
      if(token!=='AUTHORIZED' || mod!=='pos' || action!=='view')
        throw Error('POS view permission required.');
    },
    activeRows_(name){
      if(name==='SALES')return copy(activeSales);
      if(name==='SALES_RETURN')return copy(returnRows);
      throw new Error('Unexpected activeRows: '+name);
    },
    getAllRows_(name){
      if(name!=='CUSTOMER_LEDGER')throw new Error('Unexpected getAllRows: '+name);
      reads.push(name);
      return copy(ledgerRows);
    },
    customerSettlementState_(customerId,{ledgerRows,returnRows}){
      return {customerId,ledgerRows,returnRows};
    },
    customerInvoiceSettlementSnapshotFromState_(sale,state){
      if(!state||!state.customerId)throw new Error('Missing settlement state');
      return Object.prototype.hasOwnProperty.call(settlementByInvoice,sale['Invoice ID'])
        ?copy(settlementByInvoice[sale['Invoice ID']]):null;
    },
    appendRow_(){throw new Error('Test-only oracle cannot write Sheets')}
  };
  vm.createContext(context);
  vm.runInContext(utils,context,{filename:'Utils.gs',timeout:1200});
  vm.runInContext(invoice,context,{filename:'Invoice.gs',timeout:1200});
  context.logError_=()=>{}; // Never create Logs side effects from a test oracle.
  return {
    search(phone,customerId=''){
      return copy(context.findSalesByPhone('AUTHORIZED',phone,customerId));
    },
    reads
  };
}
