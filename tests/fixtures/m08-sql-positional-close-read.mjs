/**
 * TEST-ONLY M08 source-positional closing Cash Session projection.
 *
 * One tenant-scoped D1.batch of four small read-only SQL statements. Workerd's
 * SQLite resolver rejects the former deeply nested CTE in a single statement.
 * Cash movement and expected/variance arithmetic remain entirely SQL-driven;
 * JavaScript only verifies imported IDs, identity and cent-safe results.
 *
 * Frozen GAS reference: CashReconciliation.gs:
 * cashReconciliationRecalculateClosedSession_.
 * No finance writer, public Worker route or real D1 migration.
 */
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

const SESSIONS=String.raw`
  SELECT session_id,status,opening_cents,counted_cents,
         opening_entry_ids,closing_entry_ids
  FROM m08_positional_sessions WHERE tenant_id=? ORDER BY legacy_row
`;
const DUPLICATE_CASH=String.raw`
  SELECT entry_id FROM m08_positional_cash
  WHERE tenant_id=? AND entry_id<>''
  GROUP BY entry_id HAVING COUNT(*)>1 LIMIT 1
`;
const MARKERS=String.raw`
  SELECT legacy_row FROM m08_positional_cash
  WHERE tenant_id=? AND type='Session Open' AND reference=?
  ORDER BY legacy_row LIMIT 2
`;
const MOVEMENT=String.raw`
SELECT result.expected_cents,
       result.counted_cents-result.expected_cents AS variance_cents
FROM (
 SELECT t.opening_cents + COALESCE(SUM(
   CASE WHEN c.is_deleted=0
     AND c.type NOT IN ('Session Open','Day Close Adjustment')
     AND (
       (c.entry_id<>'' AND EXISTS (
         SELECT 1
         FROM json_each(CASE WHEN json_valid(t.closing_entry_ids)
           THEN t.closing_entry_ids ELSE '[]' END) link
         WHERE link.type='text' AND trim(link.value)=c.entry_id
       ))
       OR (
         c.legacy_row>marker.first_row
         AND NOT EXISTS (
           SELECT 1 FROM m08_positional_cash following
           WHERE following.tenant_id=c.tenant_id
             AND following.type='Session Open'
             AND following.legacy_row>marker.first_row
             AND following.legacy_row<=c.legacy_row
         )
         AND (c.entry_id='' OR (
           NOT EXISTS (
             SELECT 1
             FROM m08_positional_sessions s,
                  json_each(CASE WHEN json_valid(s.opening_entry_ids)
                    THEN s.opening_entry_ids ELSE '[]' END) link
             WHERE s.tenant_id=c.tenant_id AND link.type='text'
               AND trim(link.value)=c.entry_id
           )
           AND NOT EXISTS (
             SELECT 1
             FROM m08_positional_sessions s,
                  json_each(CASE WHEN json_valid(s.closing_entry_ids)
                    THEN s.closing_entry_ids ELSE '[]' END) link
             WHERE s.tenant_id=c.tenant_id AND link.type='text'
               AND trim(link.value)=c.entry_id
           )
         ))
       )
     )
     THEN c.credit_cents-c.debit_cents ELSE 0 END
 ),0) AS expected_cents,
 t.counted_cents
 FROM m08_positional_cash c
 JOIN m08_positional_sessions t
   ON t.tenant_id=c.tenant_id AND t.session_id=?
 CROSS JOIN (
   SELECT MIN(legacy_row) AS first_row FROM m08_positional_cash
   WHERE tenant_id=? AND type='Session Open' AND reference=?
 ) marker
 WHERE c.tenant_id=?
 GROUP BY t.tenant_id,t.legacy_row
) result
`;

function identity(input){
  if(!input || typeof input!=='object' || Array.isArray(input) ||
     (Object.getPrototypeOf(input)!==Object.prototype &&
      Object.getPrototypeOf(input)!==null))
    throw new TypeError('Invalid synthetic M08 SQL positional identity');
  const keys=Reflect.ownKeys(input);
  if(keys.length!==2 || !keys.includes('tenantId') ||
     !keys.includes('sessionId') ||
     keys.some(key=>{
       if(typeof key!=='string')return true;
       const property=Object.getOwnPropertyDescriptor(input,key);
       return !property || !property.enumerable ||
         !Object.hasOwn(property,'value');
     }))
    throw new TypeError('Invalid synthetic M08 SQL positional fields');
  const tenantId=Object.getOwnPropertyDescriptor(input,'tenantId').value;
  const sessionId=Object.getOwnPropertyDescriptor(input,'sessionId').value;
  if(typeof tenantId!=='string' || !ID.test(tenantId) ||
     typeof sessionId!=='string' || !ID.test(sessionId))
    throw new TypeError('Invalid synthetic M08 SQL tenant/session');
  return {tenantId,sessionId};
}
function rows(part){
  if(part?.success!==true || !Array.isArray(part.results))
    throw new Error('M08 SQL positional D1 read batch unavailable');
  return part.results;
}
function validateImportedSessionIds(sessions){
  const seen=new Set();
  for(const session of sessions){
    if(typeof session.session_id!=='string' ||
       typeof session.opening_entry_ids!=='string' ||
       typeof session.closing_entry_ids!=='string')
      throw new Error('Invalid canonical linked Cash IDs');
    if(session.session_id){
      if(seen.has(session.session_id))
        throw new Error('Duplicate Cash Session ID');
      seen.add(session.session_id);
    }
    for(const source of [
      session.opening_entry_ids,session.closing_entry_ids
    ]){
      if(source==='')continue;
      let ids;
      try{ids=JSON.parse(source);}
      catch{throw new Error('Invalid canonical linked Cash IDs');}
      if(!Array.isArray(ids) ||
         ids.some(id=>typeof id!=='string'))
        throw new Error('Invalid canonical linked Cash IDs');
    }
  }
}
function fromCents(value,label){
  if(!Number.isSafeInteger(value))
    throw new Error('Invalid M08 SQL '+label+' integer cents');
  return value/100;
}

/** Local test-only read, never a cash-posting authorization decision. */
export async function previewD1SQLPositionalClosing(DB,input){
  if(!DB || typeof DB.prepare!=='function' || typeof DB.batch!=='function')
    throw new TypeError('D1 synthetic M08 positional SQL binding unavailable');
  const {tenantId,sessionId}=identity(input);
  // D1.batch provides a transactionally consistent read of the synthetic
  // source rows; none of the statements writes or changes any cash value.
  const result=await DB.batch([
    DB.prepare(SESSIONS).bind(tenantId),
    DB.prepare(DUPLICATE_CASH).bind(tenantId),
    DB.prepare(MARKERS).bind(tenantId,sessionId),
    DB.prepare(MOVEMENT).bind(sessionId,tenantId,sessionId,tenantId)
  ]);
  if(!Array.isArray(result) || result.length!==4)
    throw new Error('M08 SQL positional D1 incomplete read batch');
  const [sessions,duplicateCash,markers,movement]=result.map(rows);
  validateImportedSessionIds(sessions);
  if(duplicateCash.length)
    throw new Error('Duplicate Cash Book Entry ID');
  if(markers.length>1)
    throw new Error('Duplicate Session Open marker');
  const target=sessions.find(s=>s.session_id===sessionId);
  if(!target || (target.status!=='Closed' && target.status!=='Closing') ||
     markers.length===0)
    return {sessionId,recalculated:null};
  if(movement.length!==1)
    throw new Error('M08 SQL positional ambiguous movement');
  return {
    sessionId,recalculated:{
      expected:fromCents(movement[0].expected_cents,'expected'),
      variance:movement[0].variance_cents===null?''
        :fromCents(movement[0].variance_cents,'variance')
    }
  };
}
