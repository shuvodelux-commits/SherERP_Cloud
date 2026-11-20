const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export function validatedReceipt(row, action) {
  if (row?.accountId !== action.accountId || row.name !== action.name ||
      row.attemptId !== action.attemptId || typeof row.id !== 'string' || !uuid.test(row.id) ||
      typeof row.evidenceRef !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(row.evidenceRef)) {
    throw new Error('CREATE_OUTCOME_UNKNOWN');
  }
  return { ...action, id: row.id, evidenceRef: row.evidenceRef };
}

/** The caller must persist the claim before allowing a first create. */
export async function reconcileCreateAttempt(provider, action, alreadyClaimed) {
  try {
    return alreadyClaimed ? await provider.findCreation({ ...action }) :
      await provider.createDatabase({ ...action });
  } catch {
    throw new Error('CREATE_OUTCOME_UNKNOWN');
  }
}
