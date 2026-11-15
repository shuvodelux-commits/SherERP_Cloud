import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';

const bytes=readFileSync(new URL('../../legacy/source/DraftSales.gs',import.meta.url));
const sha=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
if(sha!=='e34b220f97d4995be2f851c7145737d2eae1b335') {
  throw new Error('Original GAS DraftSales.gs changed');
}
const source=bytes.toString('utf8');
const clone=value=>JSON.parse(JSON.stringify(value));

export function nativeDeleteDraft(id,expectedVersion,reason,draftRows,authority){
  const trusted=authority||{};
  const now=trusted.deletedAt||'2026-11-15T13:25:00.000Z';
  class FixedDate extends Date {
    constructor(...args){super(...(args.length?args:[now]));}
    static now(){return Date.parse(now);}
  }
  const user={'User ID':trusted.actorId||''};
  const rows=structuredClone(draftRows).map((r,i)=>({...r,_rowIndex:i+2}));
  let audit=null, deletion=null;
  const events=[];
  const ctx={
    Date:FixedDate,
    CONFIG:{LOCK_TIMEOUT_MS:0},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    getSessionUser_:token=>{
      if(token!=='SYNTHETIC_AUTH_SESSION')throw new Error('Unknown token');
      return user;
    },
    hasPermission_:(_user,group,action)=>
      group==='pos'&&action==='add'?trusted.canAddPos===true:
      group==='pos'&&action==='view'?trusted.canViewPos===true:
      group==='sales'&&action==='edit'?trusted.canEditSales===true:false,
    sanitizeInput_:v=>String(v||'').trim(),
    findFirstRow_:(table,column,value)=>{
      if(table!=='SALES_DRAFTS'||column!=='Draft ID')throw new Error('Unexpected test read');
      return rows.find(r=>String(r['Draft ID'])===String(value))||null;
    },
    appendRow_:(table,data)=>{
      if(table!=='SALES_DRAFT_AUDIT')throw new Error('Unexpected test write');
      audit=clone(data);events.push('audit');
    },
    generateId_:table=>{
      if(table!=='SALES_DRAFT_AUDIT')throw new Error('Unexpected ID');
      return 'TEST-AUDIT-ID';
    },
    deleteRow_:(table,index)=>{
      if(table!=='SALES_DRAFTS')throw new Error('Unexpected delete');
      deletion={draftId:rows.find(r=>r._rowIndex===index)['Draft ID']};
      events.push('delete');
    },
    actorName_:()=>trusted.actorName||'',
    ok_:data=>({success:true,data}),
    fail_:message=>({success:false,message:String(message)}),
    logError_(){}
  };
  runInNewContext(source,ctx,{filename:'DraftSales.gs',timeout:2000});
  const native=clone(ctx.deleteSalesDraft('SYNTHETIC_AUTH_SESSION',id,expectedVersion,reason));
  const shapedAudit=audit&&{
    action:audit['Action'],draftId:audit['Draft ID'],
    draftNo:audit['Draft No'],version:audit['Version'],
    actorId:audit['Actor ID'],actorName:audit['Actor Name'],
    sourceOwnerId:audit['Source Owner ID'],
    invoiceId:audit['Invoice ID'],note:audit['Note'],
    timestamp:audit['Timestamp']
  };
  return native.success?
    {success:true,reply:native.data,audit:shapedAudit,guard:deletion,events}:
    {success:false,message:native.message,audit:null,guard:null,events};
}
