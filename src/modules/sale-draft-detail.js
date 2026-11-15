/**
 * M06 internal Saved Draft detail read projection (READ ONLY).
 *
 * Source: pinned Mohim_ERP DraftSales.gs::getSalesDraft.
 * Caller MUST derive actor/permissions from a trusted M04 session and
 * supply a tenant-scoped active draft snapshot from M03. This is NOT an
 * authentication/authorization endpoint, D1 reader or posting writer.
 */
import {parseSaleDraftRow} from './sale-draft-preview.js';

export function projectSaleDraftDetail(draftId, draftRows, {
  actorId, canAddPos, canViewPos, canEditSales
} = {}) {
  if (!Array.isArray(draftRows) || typeof actorId !== 'string' ||
      !actorId.trim() || typeof canAddPos !== 'boolean' ||
      typeof canViewPos !== 'boolean' || typeof canEditSales !== 'boolean') {
    throw new TypeError('Missing trusted draft rows, actor or permission decisions.');
  }
  if (!canAddPos && !canEditSales) {
    throw new Error('You do not have permission to access draft invoices.');
  }

  const id = draftId == null ? '' : String(draftId).trim();
  const matches = draftRows.filter(row => String(row['Draft ID'] || '') === id);
  // Original GAS findFirstRow_ chooses the first hit. Ambiguous owners must
  // never be exposed when imported source rows have colliding Draft IDs.
  if (matches.length > 1) {
    throw new Error('Duplicate draft ID detected. Repair the draft before viewing.');
  }
  const row = matches[0];
  if (!row) throw new Error('Draft not found.');

  const mine = String(row['Created By ID'] || '') === String(actorId);
  if (!mine && !canEditSales) {
    throw new Error('You do not have permission to manage this draft.');
  }
  if (!canViewPos) {
    throw new Error('You do not have permission to view POS.');
  }
  if (mine && !canEditSales && !canAddPos) {
    throw new Error('You do not have permission to manage this draft.');
  }

  return {...parseSaleDraftRow(row), mine, canManage: canEditSales || mine};
}
