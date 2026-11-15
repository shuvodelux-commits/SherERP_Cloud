/**
 * M06 internal-only Saved Draft deletion intent.
 * Frozen source: DraftSales.gs::deleteSalesDraft.
 *
 * No DB, RPC, audit INSERT, draft DELETE or financial writes. Caller MUST
 * derive actor and permissions from M04 and provide tenant-scoped active
 * draft rows from M03. An eventual D1 writer must authorize and enforce
 * tenant + owner + Version CAS + audit atomically in SQL.
 */
export function planSaleDraftDeletion(draftId,expectedVersion,reason,draftRows,trusted={}) {
  if(!Array.isArray(draftRows) || !trusted || typeof trusted!=='object' ||
      typeof trusted.actorId!=='string' || !trusted.actorId.trim() ||
      typeof trusted.actorName!=='string' || !trusted.actorName.trim() ||
      typeof trusted.canAddPos!=='boolean' ||
      typeof trusted.canViewPos!=='boolean' ||
      typeof trusted.canEditSales!=='boolean' ||
      typeof trusted.deletedAt!=='string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(trusted.deletedAt) ||
      !Number.isFinite(Date.parse(trusted.deletedAt))) {
    throw new TypeError('Missing trusted draft rows, actor, permissions or UTC timestamp.');
  }
  if(!trusted.canAddPos && !trusted.canEditSales){
    throw new Error('You do not have permission to access draft invoices.');
  }
  const id=String(draftId||'').trim();
  const matches=draftRows.filter(r=>String(r['Draft ID']||'')===id);
  // Original GAS picks first; imported duplicate IDs have ambiguous owners.
  if(matches.length>1)throw new Error('Duplicate draft ID detected. Repair the draft before deletion.');
  const row=matches[0];
  if(!row)throw new Error('Draft not found.');
  const mine=String(row['Created By ID']||'')===String(trusted.actorId);
  if(!mine && !trusted.canEditSales){
    throw new Error('You do not have permission to manage this draft.');
  }
  // mode=manage DOES NOT require pos.view. This differs from edit/details.
  if(mine && !trusted.canEditSales && !trusted.canAddPos){
    throw new Error('You do not have permission to manage this draft.');
  }
  if(Number(row['Version'])!==Number(expectedVersion)){
    throw new Error('This draft was changed by another user. Reload the latest version.');
  }
  const audit={
    action:'DELETED',draftId:row['Draft ID'],draftNo:row['Draft No'],
    version:Number(row['Version'])||1,
    actorId:trusted.actorId,actorName:trusted.actorName,
    sourceOwnerId:row['Created By ID']||'',
    invoiceId:'',note:String(reason||'').trim(),
    timestamp:trusted.deletedAt
  };
  return {reply:{draftId:id},audit,guard:{draftId:row['Draft ID']}};
}
