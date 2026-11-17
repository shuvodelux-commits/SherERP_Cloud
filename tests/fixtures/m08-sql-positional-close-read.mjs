/**
 * Test-only M08 source-positional closing Cash Session computation.
 *
 * Single parameterized SQL read over disposable local Workerd/D1 tables.
 * Flatten the SQL to a small number of CTEs: each real Cash Book row
 * contributes at most once, preventing deep SQLite CTE expansion.
 * The frozen GAS's physical Session Open marker boundaries are preserved.
 * Requires importer-normalized JSON arrays (or empty strings) for linked IDs.
 * No D1 write, public RPC, production schema, auth decision or posting.
 */
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const SQL=`
WITH
  args(tenant_id,session_id) AS (VALUES(?,?)),
  sessions AS MATERIALIZED (
    SELECT s.*,
      CASE WHEN json_valid(s.opening_entry_ids)
         THEN s.opening_entry_ids ELSE '[]' END AS opening_json,
      CASE WHEN json_valid(s.closing_entry_ids)
         THEN s.closing_entry_ids ELSE '[]' END AS closing_json
    FROM m08_positional_sessions s
    WHERE s.tenant_id=(SELECT tenant_id FROM args)
  ),
  cash AS MATERIALIZED (
    SELECT * FROM m08_positional_cash
    WHERE tenant_id=(SELECT tenant_id FROM args)
  ),
  target AS MATERIALIZED (
    SELECT * FROM sessions
    WHERE session_id=(SELECT session_id FROM args)
  ),
  marker AS MATERIALIZED (
    SELECT COUNT(*) AS n,MIN(legacy_row) AS first_row
    FROM cash
    WHERE type='Session Open'
      AND reference=(SELECT session_id FROM args)
  ),
  next_marker AS MATERIALIZED (
    SELECT MIN(c.legacy_row) AS next_row
    FROM cash c,marker m
    WHERE c.type='Session Open' AND c.legacy_row>m.first_row
  ),
  movements AS MATERIALIZED (
    SELECT CASE WHEN c.is_deleted=0
      AND c.type NOT IN ('Session Open','Day Close Adjustment')
      AND (
        (c.entry_id<>'' AND EXISTS (
          SELECT 1 FROM target t,json_each(t.closing_json) linked
          WHERE linked.type='text' AND trim(linked.value)=c.entry_id
        ))
        OR (
          c.legacy_row>m.first_row
          AND (n.next_row IS NULL OR c.legacy_row<n.next_row)
          AND (c.entry_id='' OR (
            NOT EXISTS (
              SELECT 1 FROM sessions s,json_each(s.opening_json) linked
              WHERE linked.type='text' AND trim(linked.value)=c.entry_id
            )
            AND NOT EXISTS (
              SELECT 1 FROM sessions s,json_each(s.closing_json) linked
              WHERE linked.type='text' AND trim(linked.value)=c.entry_id
            )
          ))
        )
      ) THEN c.credit_cents-c.debit_cents ELSE 0 END AS movement
    FROM cash c CROSS JOIN marker m CROSS JOIN next_marker n
  )
SELECT
  (SELECT COUNT(*) FROM target) AS target_count,
  (SELECT COUNT(*) FROM (
    SELECT session_id FROM sessions WHERE session_id<>''
    GROUP BY session_id HAVING COUNT(*)>1
  )) AS duplicate_session_count,
  (SELECT COUNT(*) FROM (
    SELECT entry_id FROM cash WHERE entry_id<>''
    GROUP BY entry_id HAVING COUNT(*)>1
  )) AS duplicate_cash_count,
  (SELECT COUNT(*) FROM sessions s WHERE
    (trim(s.opening_entry_ids)<>'' AND
       (json_valid(s.opening_entry_ids)=0 OR
        json_type(s.opening_json)<>'array')) OR
    (trim(s.closing_entry_ids)<>'' AND
       (json_valid(s.closing_entry_ids)=0 OR
        json_type(s.closing_json)<>'array')) OR
    EXISTS (SELECT 1 FROM json_each(s.opening_json) item
            WHERE item.type<>'text') OR
    EXISTS (SELECT 1 FROM json_each(s.closing_json) item
            WHERE item.type<>'text')
  ) AS malformed_link_count,
  (SELECT n FROM marker) AS marker_count,
  (SELECT status FROM target LIMIT 1) AS status,
  (SELECT opening_cents FROM target LIMIT 1) +
    COALESCE((SELECT SUM(movement) FROM movements),0) AS expected_cents,
  (SELECT counted_cents FROM target LIMIT 1) -
   ((SELECT opening_cents FROM target LIMIT 1) +
    COALESCE((SELECT SUM(movement) FROM movements),0)) AS variance_cents
`;
function identity(value){
  if(!value || typeof value!=='object' || Array.isArray(value) ||
     (Object.getPrototypeOf(value)!==Object.prototype &&
      Object.getPrototypeOf(value)!==null))
    throw new TypeError('Invalid synthetic M08 SQL positional identity');
  const keys=Reflect.ownKeys(value);
  if(keys.length!==2 || !keys.includes('tenantId') ||
     !keys.includes('sessionId') ||
     keys.some(key=>{
       if(typeof key!=='string')return true;
       const prop=Object.getOwnPropertyDescriptor(value,key);
       return !prop || !prop.enumerable || !Object.hasOwn(prop,'value');
     }))
    throw new TypeError('Invalid synthetic M08 SQL positional fields');
  const tenantId=Object.getOwnPropertyDescriptor(value,'tenantId').value;
  const sessionId=Object.getOwnPropertyDescriptor(value,'sessionId').value;
  if(typeof tenantId!=='string' || !ID.test(tenantId) ||
     typeof sessionId!=='string' || !ID.test(sessionId))
    throw new TypeError('Invalid synthetic M08 SQL tenant/session');
  return {tenantId,sessionId};
}

function requireCents(value,label){
  if(!Number.isSafeInteger(value))
    throw new Error('Invalid SQL Cash '+label+' integer cents');
  return value/100;
}

export async function previewD1SQLPositionalClosing(DB,input){
  if(!DB || typeof DB.prepare!=='function')
    throw new TypeError('D1 synthetic M08 positional SQL binding unavailable');
  const {tenantId,sessionId}=identity(input);
  // One SQLite statement obtains one tenant-scoped source snapshot. A JS
  // preflight calculation would not protect a future financial commit.
  const result=await DB.prepare(SQL).bind(tenantId,sessionId).first();
  if(!result || !Number.isSafeInteger(result.target_count) ||
     !Number.isSafeInteger(result.marker_count))
    throw new Error('M08 SQL positional source snapshot unavailable');
  if(result.duplicate_session_count>0)
    throw new Error('Duplicate Cash Session ID');
  if(result.duplicate_cash_count>0)
    throw new Error('Duplicate Cash Book Entry ID');
  if(result.malformed_link_count>0)
    throw new Error('Invalid canonical linked Cash IDs');
  if(result.marker_count>1)
    throw new Error('Duplicate Session Open marker');
  if(result.target_count>1)
    throw new Error('Duplicate Cash Session ID');
  if(result.target_count===0 ||
     (result.status!=='Closed' && result.status!=='Closing') ||
     result.marker_count===0)
    return {sessionId,recalculated:null};
  return {
    sessionId,
    recalculated:{
      expected:requireCents(result.expected_cents,'expected'),
      variance:result.variance_cents===null
        ?'':requireCents(result.variance_cents,'variance')
    }
  };
}
