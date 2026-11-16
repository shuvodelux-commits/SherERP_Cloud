/**
 * M06 internal read-only Saved Drafts list projection.
 *
 * Frozen source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * DraftSales.gs::getSalesDraftList.
 *
 * This module does not perform authentication, tenant-scoped D1 reads, RPC
 * routing or financial writes. The caller must enforce pos.add OR sales.edit
 * and obtain actorId/manageAll solely from the authenticated server session.
 */
export function projectSaleDraftList(draftRows, {actorId, manageAll} = {}) {
  if (!Array.isArray(draftRows) || typeof actorId !== 'string' ||
      !actorId.trim() || typeof manageAll !== 'boolean') {
    throw new TypeError('Trusted draft list rows, actor identity and manageAll authority are required.');
  }

  // Inspect the complete trusted tenant snapshot before staff filtering:
  // a colliding ID owned by someone else must not be hidden from this guard.
  const draftIds=new Set();
  for(const row of draftRows){
    const id=String(row['Draft ID']||'');
    if(id && draftIds.has(id)){
      throw new Error('NEEDS_REVIEW: duplicate Sales Draft ID in tenant snapshot');
    }
    if(id)draftIds.add(id);
  }

  return draftRows
    .filter(row => manageAll || String(row['Created By ID']) === String(actorId))
    .sort((a, b) => new Date(b['Updated At']) - new Date(a['Updated At']))
    .map(row => {
      const mine = String(row['Created By ID']) === String(actorId);
      return {
        draftId: row['Draft ID'],
        draftNo: row['Draft No'],
        draftDate: row['Draft Date'] ? String(row['Draft Date']).slice(0, 10) : '',
        customerId: row['Customer ID'] || '',
        customerName: row['Customer Name'] || '',
        customerPhone: row['Customer Phone'] || '',
        subtotal: Number(row['Subtotal']) || 0,
        discount: Number(row['Discount']) || 0,
        grandTotal: Number(row['Grand Total']) || 0,
        createdById: row['Created By ID'] || '',
        createdByName: row['Created By Name'] || '',
        updatedAt: row['Updated At'] || '',
        version: Number(row['Version']) || 1,
        mine,
        canManage: manageAll || mine
      };
    });
}
