/**
 * NONDEPLOYABLE, TEST-ONLY SQL-current role-permission text inspection.
 *
 * Do not invoke this function from Worker/RPC, authorize an actor from its
 * result, or separate it from a future M03-owned atomic mutation.
 * Demonstrates the A05 duplicate-key rejection requirement to the integrator.
 */
const REVIEWED_ACTION_PATHS=Object.freeze({
  'sales.add':Object.freeze(['$.sales','$.sales.add']),
  'products.add':Object.freeze(['$.products','$.products.add']),
});

const PROOF_SQL=`
WITH submitted(permission_text) AS (VALUES (?))
SELECT CASE
  WHEN length(permission_text)<=65536 AND json_valid(permission_text)=1
  THEN CASE
    WHEN json_type(permission_text)='object'
      AND json_type(permission_text,?)='object'
      AND json_type(permission_text,?)='true'
      AND NOT EXISTS (
        SELECT 1
        FROM json_tree(permission_text)
        WHERE key IS NOT NULL
        GROUP BY parent,key HAVING COUNT(*)>1
      )
    THEN 1 ELSE 0 END
  ELSE 0 END AS granted
FROM submitted`;

/**
 * Inspect synthetic JSON text only; does not check an auth_sessions row,
 * trusted tenant or server clock, receipt, inventory, financial journal or
 * a live operator's authority. Not a deployable role-permission API.
 */
export async function inspectSyntheticRoleGrantWithD1(db,{permissionsJson,operation}={}){
  if(!db || typeof db.prepare!=='function')
    throw new TypeError('Real local D1 test binding required');
  if(typeof operation!=='string' ||
     !Object.hasOwn(REVIEWED_ACTION_PATHS,operation))return false;
  if(typeof permissionsJson!=='string' || !permissionsJson.length ||
     permissionsJson.length>65536)return false;
  const [modulePath,actionPath]=REVIEWED_ACTION_PATHS[operation];
  const result=await db.prepare(PROOF_SQL)
    .bind(permissionsJson,modulePath,actionPath).first();
  return result?.granted===1;
}
