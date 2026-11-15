import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Test-only native GAS oracle; all data access is immutable injected fixture rows.
// The pinned original is separately verified by npm run verify:source (84 files).
const sources=['SalePayments.gs','Invoice.gs'].map(file=>readFileSync(
  new URL('../../legacy/source/'+file,import.meta.url),'utf8'
));
const copy=value=>JSON.parse(JSON.stringify(value));

export function createNativePostedInvoiceOracle({
  saleRows=[],itemRows=[],productRows=[],customerRows=[],paymentRows=[],settings={},
  settlement=null
}={}) {
  const data={SALES:saleRows,SALE_ITEMS:itemRows,PRODUCTS:productRows,
    CUSTOMERS:customerRows,SALE_PAYMENTS:paymentRows};
  const scope={
    CONFIG:{APP_NAME:'SherERP'},
    findRows_(name,key,value){
      if(!Object.prototype.hasOwnProperty.call(data,name))throw Error('Unexpected source row lookup: '+name);
      return copy(data[name].filter(row=>row[key]===value));
    },
    getAllRows_(name){
      if(!Object.prototype.hasOwnProperty.call(data,name))throw Error('Unexpected GAS table lookup: '+name);
      return copy(data[name]);
    },
    getSettingsMap_:()=>copy(settings),
    customerInvoiceSettlementSnapshot_:()=>settlement===null?null:copy(settlement),
    isDeleted_:row=>String(row['Is Deleted']||'').toUpperCase()==='TRUE' || row.Status==='Deleted',
    normalizeCustomerRelationType_:value=>String(value||'').trim()==='Husband'?'Husband':'Father',
    safeDateOnly_:value=>value?String(value).slice(0,10):'',
    safeTimeOnly_:value=>{
      if(!value)return '';
      const valueText=String(value).trim();
      const iso=valueText.match(/T(\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/);
      if(iso)return iso[1];
      const plain=valueText.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      if(plain)return plain[1].padStart(2,'0')+':'+plain[2]+':'+(plain[3]||'00');
      return valueText;
    },
    isSettingEnabled_:(value,fallback)=>value===''||value===null||value===undefined?fallback:
      ['true','yes','1'].includes(String(value).trim().toLowerCase()),
    formatDate_:value=>new Date(value).toISOString().slice(0,10)
  };
  sources.forEach((s,i)=>runInNewContext(s,scope,{filename:['SalePayments.gs','Invoice.gs'][i],timeout:1000}));
  return {
    shop:()=>copy(scope.buildInvoiceShopPayload_(copy(settings))),
    invoice:id=>copy(scope.buildInvoicePayload_(id))
  };
}
