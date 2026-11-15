import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

// Test ONLY: run exact pinned GAS update (including the original audit helper)
// against synthetic in-memory source rows. Never import into the Worker.
const sources=[
  ['SalePayments.gs','dd08b0c1e27a799c9c16feda50239f172eb7eb4f'],
  ['DraftSales.gs','e34b220f97d4995be2f851c7145737d2eae1b335']
];
const frozen=([name,sha])=>{
  const bytes=readFileSync(new URL('../../legacy/source/'+name,import.meta.url));
  const found=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if(found!==sha)throw new Error('Changed frozen GAS source: '+name);
  return bytes.toString('utf8');
};
const plain=value=>JSON.parse(JSON.stringify(value));

export function nativeUpdateSalesDraft(draftId,expectedVersion,payload,draftRows,authority) {
  const trusted=authority||{};
  const time=trusted.updatedAt||'2026-11-15T15:05:00.000Z';
  class FixedDate extends Date {
    constructor(...args){super(...(args.length?args:[time]));}
    static now(){return Date.parse(time);}
  }
  const user={'User ID':trusted.actorId||'','Display Name':trusted.actorName||''};
  const rows=structuredClone(draftRows).map((row,i)=>({...row,_rowIndex:i+2}));
  let capturedFields=null, capturedAudit=null;
  const context={
    Date:FixedDate,
    CONFIG:{LOCK_TIMEOUT_MS:0},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    getSessionUser_:token=>{
      if(token!=='SOURCE_TEST_SESSION')throw new Error('Invalid synthetic test session');
      return user;
    },
    hasPermission_:(_user,group,action)=>{
      if(group==='pos'&&action==='add')return trusted.canAddPos===true;
      if(group==='pos'&&action==='view')return trusted.canViewPos===true;
      if(group==='sales'&&action==='edit')return trusted.canEditSales===true;
      return false;
    },
    sanitizeInput_:value=>String(value||'').trim(),
    isValidNonNegativeNumber_:value=>{
      const n=Number(value);return !isNaN(n)&&isFinite(n)&&n>=0;
    },
    roundMoney_:value=>{
      const n=Number(value)||0;return Math.round((n+Number.EPSILON)*100)/100;
    },
    normalizeCustomerRelationType_:value=>String(value||'').trim()==='Husband'?'Husband':'Father',
    getSettingsMap_:()=>structuredClone(trusted.settings||{}),
    getAllRows_:group=>{
      if(group!=='BANK_ACCOUNTS')throw new Error('Unexpected source read: '+group);
      return structuredClone(trusted.bankAccounts||[]);
    },
    findFirstRow_:(group,column,id)=>{
      if(group!=='SALES_DRAFTS'||column!=='Draft ID')throw new Error('Unexpected draft read');
      return rows.find(row=>String(row['Draft ID'])===String(id))||null;
    },
    updateRowFields_:(group,rowIndex,fields)=>{
      if(group!=='SALES_DRAFTS')throw new Error('Unexpected source write');
      const row=rows.find(r=>r._rowIndex===rowIndex);
      if(!row)throw new Error('Missing synthetic source row');
      capturedFields=plain(fields);
      Object.assign(row,fields);
    },
    appendRow_:(group,record)=>{
      if(group!=='SALES_DRAFT_AUDIT')throw new Error('Unexpected source audit write');
      capturedAudit=plain(record);
    },
    generateId_:table=>{
      if(table!=='SALES_DRAFT_AUDIT')throw new Error('Unexpected ID allocation');
      return 'SYNTHETIC-AUDIT-ID';
    },
    actorName_:()=>trusted.actorName||'',
    ok_:data=>({success:true,data}),
    fail_:message=>({success:false,message:String(message)}),
    logError_(){ }
  };
  vm.createContext(context);
  for(const source of sources)vm.runInContext(frozen(source),context,{filename:source[0],timeout:2000});
  const result=plain(context.updateSalesDraft('SOURCE_TEST_SESSION',draftId,expectedVersion,structuredClone(payload)));
  const audit=capturedAudit&&{
    action:capturedAudit['Action'],
    draftId:capturedAudit['Draft ID'],
    draftNo:capturedAudit['Draft No'],
    version:capturedAudit['Version'],
    actorId:capturedAudit['Actor ID'],
    actorName:capturedAudit['Actor Name'],
    sourceOwnerId:capturedAudit['Source Owner ID'],
    invoiceId:capturedAudit['Invoice ID'],
    note:capturedAudit['Note'],
    timestamp:capturedAudit['Timestamp']
  };
  return result.success
    ? {success:true,reply:result.data,fields:capturedFields,audit}
    : {success:false,message:result.message,fields:capturedFields,audit};
}
