/**
 * INTERNAL M02-P review queue diagnostic.
 * Counts unresolved identity reviews without exposing source IDs, phones,
 * names, reviewer IDs or arbitrary client-selected SQL. Not a public RPC,
 * approval action, or evidence of authenticated review.
 *
 * Mohim_ERP source pin: 29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 */
const REASONS=new Set([
  'MISSING_ID','DUPLICATE_ID','SHARED_PHONE','SAME_NAME',
  'LEGACY_NAME_ALIAS','CONFLICT','OTHER'
]);

const QUERY=`SELECT reason, COUNT(*) AS count
  FROM party_identity_review
  WHERE status='OPEN'
  GROUP BY reason
  ORDER BY reason`;

/** @returns {{totalOpen:number,byReason:Array<{reason:string,count:number}>}} */
export async function summarizeOpenPartyIdentityReviews({DB}={}){
  if(!DB || typeof DB.prepare!=='function')
    throw new Error('Party review D1 binding unavailable');
  let rows;
  try {
    const statement=DB.prepare(QUERY);
    const result=await statement.all();
    if(!result || result.success===false || !Array.isArray(result.results))
      throw new Error('Unexpected review count result');
    rows=result.results;
  } catch {
    // D1 exceptions may include raw SQLite values or sensitive source data.
    throw new Error('Party identity review summary unavailable');
  }

  const seen=new Set();
  let totalOpen=0;
  const byReason=[];
  for(const row of rows){
    if(!row || !REASONS.has(row.reason) || seen.has(row.reason) ||
      !Number.isSafeInteger(row.count) || row.count<0 ||
      !Number.isSafeInteger(totalOpen+row.count))
      throw new Error('Invalid Party identity review summary');
    seen.add(row.reason);
    totalOpen+=row.count;
    byReason.push({reason:row.reason,count:row.count});
  }
  byReason.sort((a,b)=>a.reason.localeCompare(b.reason));
  return {totalOpen,byReason};
}
