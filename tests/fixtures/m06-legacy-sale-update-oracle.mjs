import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {createNativeSaleLineTotalOracle} from './m06-sale-update-line-totals-oracle.mjs';

/** Test-only independent reference: runs actual frozen GAS payment block. */
const hashes={
  'SalesManagement.gs':'43afb640bfe46962c3715fa8a2ee08ab3fdda1aa',
  'Utils.gs':'dd893411263fbf72a32616a3b8434bf74fb08350'
};
function source(name,expected){
  const bytes=readFileSync(new URL('../../legacy/source/'+name,import.meta.url));
  const actual=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
  if(actual!==expected)throw new Error('Frozen original GAS changed: '+name);
  return bytes.toString('utf8');
}
function namedFunction(code,name){
  const start=code.indexOf('function '+name+'(');
  if(start<0)throw new Error('Original helper unavailable: '+name);
  const end=code.indexOf('\n}',start);
  if(end<0)throw new Error('Incomplete original helper: '+name);
  return code.slice(start,end+2);
}
export function createNativeLegacySaleUpdateOracle(){
  const utils=source('Utils.gs',hashes['Utils.gs']);
  const sales=source('SalesManagement.gs',hashes['SalesManagement.gs']);
  const begin=sales.indexOf('const discount = isValidNonNegativeNumber_(payload.discount)');
  const finish=sales.indexOf('const oldPaidAmount = Number(sale[',begin);
  if(begin<0 || finish<begin || finish-begin>3500)
    throw new Error('Original single-payment edit block changed');
  const branch=sales.slice(begin,finish);
  if(!branch.includes("paymentType === 'Cash'") ||
     !branch.includes("paymentType === 'Due'") ||
     !branch.includes("paymentType === 'Partial'") ||
     !branch.includes('resolveBankAccount_(')){
    throw new Error('Legacy original Cash/Due/Partial branch changed');
  }
  const ctx=vm.createContext({
    getAllRows_(table){
      if(table!=='BANK_ACCOUNTS')throw new Error('Unexpected original GAS sheet '+table);
      return ctx.__banks;
    }
  });
  const names=['sanitizeInput_','isValidNonNegativeNumber_','roundMoney_',
    'isBankLikePaymentMethod_','resolveBankAccount_'];
  const constantStart=utils.indexOf('const BANK_LIKE_PAYMENT_METHODS = ');
  const constantEnd=utils.indexOf(';',constantStart);
  if(constantStart<0||constantEnd<0)throw new Error('Original bank methods constant changed');
  vm.runInContext(utils.slice(constantStart,constantEnd+1),ctx,{timeout:1000});
  for(const name of names){
    vm.runInContext(namedFunction(utils,name),ctx,{filename:'Utils.gs',timeout:1000});
  }
  const lineOracle=createNativeSaleLineTotalOracle();
  const script=`(()=>{
    const payload=__payload, subtotal=__subtotal, isSplitInvoice=false;
    ${branch}
    return {discount,grandTotal,paidAmount,dueAmount,paymentType,
      paymentStatus,paymentMethod,bankAccountId,bankAccountName};
  })()`;
  return Object.freeze({
    project(snapshot){
      const input=structuredClone(snapshot);
      const {subtotal,lines}=lineOracle.sourcePlan(input.invoiceId,input.oldItems,input.newItems);
      ctx.__subtotal=subtotal;
      ctx.__banks=input.bankAccounts;
      ctx.__payload={
        discount:input.discount,paymentType:input.paymentType,
        paidAmount:input.paidAmount,paymentMethod:input.paymentMethod,
        bankAccountId:input.bankAccountId
      };
      const native=vm.runInContext(script,ctx,{filename:'SalesManagement.gs::updateSaleInternal_',timeout:1000});
      return structuredClone({invoiceId:input.invoiceId,subtotal,lines,...native});
    }
  });
}
