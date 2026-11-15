/** Execute immutable GAS Invoice.gs + SalePayments.gs as an independent oracle. */
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const nativePayments=readFileSync(new URL('../../legacy/source/SalePayments.gs',import.meta.url),'utf8');
const nativeInvoice=readFileSync(new URL('../../legacy/source/Invoice.gs',import.meta.url),'utf8');

export function pinnedPostedInvoice(fixture){
  const groups={
    SALES:fixture.sales,
    SALE_ITEMS:fixture.items,
    PRODUCTS:fixture.products,
    CUSTOMERS:fixture.customers,
    SALE_PAYMENTS:fixture.paymentRows
  };
  const settings=fixture.settings;
  const vm={
    CONFIG:{APP_NAME:'SherERP'},
    getAllRows_:key=>groups[key] || [],
    findRows_:(key,col,value)=>(groups[key] || []).filter(r=>String(r[col])===String(value)),
    getSettingsMap_:()=>settings,
    isDeleted_:row=>String(row['Is Deleted']||'').toUpperCase()==='TRUE',
    safeDateOnly_:value=>value?String(value).slice(0,10):'',
    safeTimeOnly_:value=>{
      if(!value)return '';
      const text=String(value).trim();
      const iso=text.match(/T(\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/);
      if(iso)return iso[1];
      const plain=text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      return plain?String(plain[1]).padStart(2,'0')+':'+plain[2]+':'+(plain[3]||'00'):text;
    },
    normalizeCustomerRelationType_:value=>String(value||'').trim()==='Husband'?'Husband':'Father',
    customerInvoiceSettlementSnapshot_:()=>fixture.settlement??null,
    resolveInvoiceLogoDataUri_:()=> '',
    isSettingEnabled_:(value,fallback)=>value==null||value===''?fallback:String(value).toLowerCase()==='true',
    // Frozen Utils.gs::formatDate_ uses Utilities.formatDate with the
    // Apps Script timezone; UTC ISO slicing shifts local-midnight dates.
    formatDate_:date=>{
      const parts=new Intl.DateTimeFormat('en-US',{
        timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'
      }).formatToParts(new Date(date));
      const part=type=>parts.find(x=>x.type===type)?.value;
      return part('year')+'-'+part('month')+'-'+part('day');
    }
  };
  runInNewContext(nativePayments+'\n'+nativeInvoice,vm);
  // The shop branding is a separate authenticated Settings/Drive adapter.
  // Its source projection is supplied to the new pure read model explicitly.
  const payload=vm.buildInvoicePayload_(fixture.invoiceId);
  return JSON.parse(JSON.stringify(payload));
}
