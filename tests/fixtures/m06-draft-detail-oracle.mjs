import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Read-only native GAS oracle: frozen original code, injected synthetic rows
// and permission decisions. No SpreadsheetApp, token verification or network.
const source=readFileSync(new URL('../../legacy/source/DraftSales.gs',import.meta.url),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));

export function nativeGetSalesDraft(id, rows, access) {
  const p=access||{},actor={'User ID':p.actorId||''};
  const scope={
    getSessionUser_(token){
      if(token!=='AUTHORIZED_SOURCE_ONLY')throw new Error('Invalid test token');
      return clone(actor);
    },
    hasPermission_(user,group,action){
      if(group==='pos' && action==='add')return !!p.canAddPos;
      if(group==='pos' && action==='view')return !!p.canViewPos;
      if(group==='sales' && action==='edit')return !!p.canEditSales;
      return false;
    },
    findFirstRow_(key,column,value){
      if(key!=='SALES_DRAFTS'||column!=='Draft ID')throw new Error('Unexpected GAS read');
      const match=rows.find(row=>String(row['Draft ID'])===String(value));
      return match ? clone(match) : null;
    },
    sanitizeInput_:value=>value===null||value===undefined?'':String(value).trim(),
    safeDateOnly_:value=>value?String(value).slice(0,10):'',
    normalizeCustomerRelationType_:value=>String(value||'').trim()==='Husband'?'Husband':'Father',
    ok_:value=>({success:true,data:value}),
    fail_:message=>({success:false,message:String(message)}),
    logError_(){ /* no source log writes from isolated oracle */ }
  };
  runInNewContext(source,scope,{filename:'DraftSales.gs',timeout:2000});
  return clone(scope.getSalesDraft('AUTHORIZED_SOURCE_ONLY',id));
}
