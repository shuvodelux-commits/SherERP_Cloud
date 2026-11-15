import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Original pinned GAS executes only in the Node test process, never in Worker.
// Explicit stubs only for the GAS environment; the actual validation and
// payment calculator are loaded from untouched legacy/source files.
const draftSource=readFileSync(new URL('../../legacy/source/DraftSales.gs',import.meta.url),'utf8');
const paymentSource=readFileSync(new URL('../../legacy/source/SalePayments.gs',import.meta.url),'utf8');
const jsonClone=x=>JSON.parse(JSON.stringify(x));

export function originalDraftPayload(payload,{settings,bankAccounts}={}) {
  const context={
    sanitizeInput_:v=>v===null||v===undefined?'':String(v).trim(),
    isValidNonNegativeNumber_:v=>{const n=Number(v);return !isNaN(n)&&isFinite(n)&&n>=0;},
    roundMoney_:v=>{const n=Number(v)||0;return Math.round((n+Number.EPSILON)*100)/100;},
    normalizeCustomerRelationType_:v=>String(v||'').trim()==='Husband'?'Husband':'Father',
    getSettingsMap_:()=>jsonClone(settings||{}),
    getAllRows_:table=>{
      if(table!=='BANK_ACCOUNTS')throw new Error('Unexpected source Sheet read: '+table);
      return jsonClone(bankAccounts||[]);
    }
  };
  vm.createContext(context);
  vm.runInContext(paymentSource,context,{filename:'SalePayments.gs',timeout:2000});
  vm.runInContext(draftSource,context,{filename:'DraftSales.gs',timeout:2000});
  try {
    return {success:true,data:jsonClone(context.validateSalesDraftPayload_(jsonClone(payload)))};
  } catch(error) {
    return {success:false,message:error.message};
  }
}
