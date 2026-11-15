import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Test-only native GAS implementation, loaded from the original frozen source.
// The VM has no networking, database adapter, filesystem write or Sheets API.
const source=readFileSync(new URL('../../legacy/source/DraftSales.gs',import.meta.url),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));

export function originalSalesDraftList(rows,actor,permissions={}) {
  const data=clone(rows);
  const authorizedActor=clone(actor);
  const scope={
    getSessionUser_(token) {
      if(token!=='SOURCE-AUTH')throw new Error('Invalid source session token.');
      return authorizedActor;
    },
    hasPermission_(user,module,action) {
      if(module==='pos' && action==='add')return !!permissions.posAdd;
      if(module==='sales' && action==='edit')return !!permissions.salesEdit;
      return false;
    },
    getAllRows_(sheet) {
      if(sheet!=='SALES_DRAFTS')throw new Error('Unexpected original Sheet lookup: '+sheet);
      return clone(data);
    },
    safeDateOnly_(value) { return value?String(value).slice(0,10):''; },
    ok_:value=>({success:true,data:value}),
    fail_:message=>({success:false,message:String(message)}),
    logError_(){ /* no mock spreadsheet writes for this read-only parity oracle */ }
  };
  runInNewContext(source,scope,{filename:'DraftSales.gs',timeout:1500});
  return clone(scope.getSalesDraftList('SOURCE-AUTH'));
}
