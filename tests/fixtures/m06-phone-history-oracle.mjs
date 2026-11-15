/** Independent source oracle: executes immutable Utils.gs + Invoice.gs. */
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const utils=readFileSync(new URL('../../legacy/source/Utils.gs',import.meta.url),'utf8');
const invoice=readFileSync(new URL('../../legacy/source/Invoice.gs',import.meta.url),'utf8');

export function sourceFindSalesByPhone(query,fixture){
  // Source functions execute unchanged; only external GAS services/sheets are
  // replaced by fixture-backed read-only stubs.
  const context={
    Session:{getScriptTimeZone:()=> 'Asia/Dhaka'},
    Utilities:{formatDate:(date,_tz,format)=>{
      const iso=new Date(date).toISOString();
      if(format==='yyyy-MM-dd')return iso.slice(0,10);
      if(format==='HH:mm:ss')return iso.slice(11,19);
      throw new Error('Unsupported test date format');
    }},
    requirePermission_:(_token,module,action)=>{
      if(module!=='pos'||action!=='view')throw new Error('Unexpected source permission');
      return { 'User ID':'STAFF-1'};
    },
    activeRows_:key=>{
      const rows=key==='SALES'?fixture.saleRows:key==='SALES_RETURN'?fixture.returnRows:[];
      return rows.filter(row=>String(row['Is Deleted']||'').toUpperCase()!=='TRUE');
    },
    getAllRows_:key=>key==='CUSTOMER_LEDGER'?fixture.ledgerRows:[],
    customerSettlementState_:(id,{ledgerRows,returnRows})=>({
      id,ledgerRows,returnRows
    }),
    customerInvoiceSettlementSnapshotFromState_:(row,state)=>{
      if(state.id!==String(row['Customer ID']||''))throw new Error('Cross-customer settlement read');
      const status=fixture.settlementStatusByInvoice[row['Invoice ID']];
      return status?{paymentStatus:status}:null;
    },
    Logger:{log:()=>{}}
  };
  runInNewContext(utils+'\n'+invoice,context);
  const response=context.findSalesByPhone('trusted-session',query.phone,query.customerId||'');
  return JSON.parse(JSON.stringify(response));
}
