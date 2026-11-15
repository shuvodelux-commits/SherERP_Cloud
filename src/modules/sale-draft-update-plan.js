/**
 * M06 internal-only saved POS draft UPDATE preflight.
 * Source: frozen Mohim_ERP DraftSales.gs::updateSalesDraft.
 *
 * This is NOT a D1 writer, CAS transaction, audit INSERT, RPC or permission
 * boundary. M04 must derive all actor rights; M03 must provide tenant-filtered
 * active drafts, business settings and bank accounts. Future writes must
 * enforce owner, Version CAS and audit in one reviewed D1 transaction.
 */
import {projectSaleDraftDetail} from './sale-draft-detail.js';
import {validateSaleDraftPayload} from './sale-draft-payload.js';

const relation=value=>String(value||'').trim()==='Husband'?'Husband':'Father';

/** Source-shaped row field + audit *intent*, never a persisted row. */
export function planSaleDraftUpdate(draftId,expectedVersion,payload,draftRows,trusted={}) {
  if(!trusted || typeof trusted!=='object' ||
      typeof trusted.actorId!=='string' || !trusted.actorId.trim() ||
      typeof trusted.actorName!=='string' || !trusted.actorName.trim() ||
      typeof trusted.canAddPos!=='boolean' ||
      typeof trusted.canViewPos!=='boolean' ||
      typeof trusted.canEditSales!=='boolean' ||
      !Array.isArray(trusted.bankAccounts) ||
      !trusted.settings || typeof trusted.settings!=='object' ||
      Array.isArray(trusted.settings) ||
      typeof trusted.updatedAt!=='string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(trusted.updatedAt) ||
      !Number.isFinite(Date.parse(trusted.updatedAt))) {
    throw new TypeError('Missing trusted actor, permissions, business snapshots or UTC timestamp.');
  }
  // Reuse source-shaped feature, owner, manager and POS-view rules. This is
  // defense in depth only; the future D1 SQL operation still needs its own
  // atomic authenticated authorization and version guard at commit.
  const id=draftId==null?'':String(draftId).trim();
  projectSaleDraftDetail(id,draftRows,trusted);
  const row=draftRows.find(r=>String(r['Draft ID']||'')===id);
  if(Number(row['Version'])!==Number(expectedVersion)) {
    throw new Error('This draft was changed by another user. Reload the latest version.');
  }

  const clean=validateSaleDraftPayload(payload||{},trusted);
  if(!Object.prototype.hasOwnProperty.call(payload||{},'customerRelationType')) {
    clean.customerRelationType=relation(row['Customer Relation Type']);
  }
  const version=Number(row['Version'])+1;
  const fields={
    'Customer ID':clean.customerId,
    'Customer Name':clean.customerName,
    'Customer Phone':clean.customerPhone,
    'Customer Father Name':clean.customerFatherName,
    'Customer Relation Type':clean.customerRelationType,
    'Customer Address':clean.customerAddress,
    'Items JSON':clean.itemsJson,
    'Payment JSON':clean.paymentJson,
    'Notes':clean.notes,
    'Subtotal':clean.subtotal,
    'Discount':clean.discount,
    'Grand Total':clean.grandTotal,
    'Updated By ID':trusted.actorId,
    'Updated By Name':trusted.actorName,
    'Updated At':trusted.updatedAt,
    'Version':version
  };
  return {
    reply:{draftId:id,draftNo:row['Draft No'],version},
    fields,
    audit:{
      action:'UPDATED',draftId:id,draftNo:row['Draft No'],version,
      actorId:trusted.actorId,actorName:trusted.actorName,
      sourceOwnerId:row['Created By ID']||'',invoiceId:'',note:'',
      timestamp:trusted.updatedAt
    }
  };
}
