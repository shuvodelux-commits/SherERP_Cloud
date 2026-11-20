/**
 * Isolated M04 synthetic Workerd/D1 SQL-time Cash Session authority.
 *
 * TEST-ONLY: not an ERP cash writer, ledger, public endpoint, real auth
 * migration, source payment contract or permission to activate production.
 * tokenHash/now are provided by a trusted local fixture, never the browser.
 */
const KEY=/^[A-Z0-9][A-Z0-9_-]{0,63}$/;
const DIGEST=/^[a-f0-9]{64}$/;

function validated(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||
      (Object.getPrototypeOf(input)!==Object.prototype &&
       Object.getPrototypeOf(input)!==null))
    throw new TypeError('Invalid M04 synthetic cash request');
  const fields=['tokenHash','tenantId','operationId','cashSessionId','amountMinor','now'];
  const keys=Reflect.ownKeys(input);
  if(keys.length!==fields.length||
      keys.some(key=>typeof key!=='string'||!fields.includes(key)))
    throw new TypeError('Invalid M04 synthetic cash request fields');
  for(const key of fields){
    const descriptor=Object.getOwnPropertyDescriptor(input,key);
    if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))
      throw new TypeError('Invalid M04 synthetic cash request descriptor');
  }
  if(typeof input.tokenHash!=='string'||!DIGEST.test(input.tokenHash)||
      typeof input.tenantId!=='string'||!KEY.test(input.tenantId)||
      typeof input.operationId!=='string'||!KEY.test(input.operationId)||
      (input.cashSessionId!==null &&
        (typeof input.cashSessionId!=='string'||!KEY.test(input.cashSessionId)))||
      !Number.isSafeInteger(input.amountMinor)||input.amountMinor<=0||
      !Number.isSafeInteger(input.now)||input.now<0)
    throw new TypeError('Invalid M04 synthetic cash amount, session, scope or clock');
  return input;
}

const JOINS=`FROM synthetic_auth_sessions AS s
  JOIN synthetic_auth_users AS u
    ON u.tenant_id=s.tenant_id AND u.user_id=s.user_id
  JOIN synthetic_auth_roles AS r
    ON r.tenant_id=s.tenant_id AND r.role_id=s.role_id
  JOIN synthetic_m04_cash_policy AS p ON p.tenant_id=s.tenant_id
  JOIN synthetic_m04_cash_grants AS g
    ON g.tenant_id=r.tenant_id AND g.role_id=r.role_id`;

const CURRENT=`s.token_hash=? AND s.tenant_id=? AND s.revoked_at IS NULL
  AND s.expires_at>?
  AND u.status='Active' AND r.status='Active' AND r.can_edit=1
  AND u.role_id=s.role_id
  AND u.auth_version=s.user_version AND r.auth_version=s.role_version
  AND g.allowed=1
  AND ((p.session_required=0 AND ? IS NULL)
    OR EXISTS (
      SELECT 1 FROM synthetic_m04_cash_sessions AS cs
      WHERE cs.tenant_id=s.tenant_id AND cs.session_id=?
        AND cs.status='Open'
    ))`;

const INSERT=`INSERT INTO synthetic_m04_cash_actions
  (tenant_id,operation_id,actor_id,cash_session_id,amount_minor)
  SELECT s.tenant_id,?,u.user_id,?,? ${JOINS}
  WHERE ${CURRENT}
  ON CONFLICT(tenant_id,operation_id) DO NOTHING`;

const READ=`SELECT a.operation_id,a.actor_id,a.amount_minor,
    a.cash_session_id,u.user_id AS current_actor_id
  FROM synthetic_m04_cash_actions AS a
  JOIN synthetic_auth_sessions AS s ON s.tenant_id=a.tenant_id
  JOIN synthetic_auth_users AS u
    ON u.tenant_id=s.tenant_id AND u.user_id=s.user_id
  JOIN synthetic_auth_roles AS r
    ON r.tenant_id=s.tenant_id AND r.role_id=s.role_id
  JOIN synthetic_m04_cash_policy AS p ON p.tenant_id=s.tenant_id
  JOIN synthetic_m04_cash_grants AS g
    ON g.tenant_id=r.tenant_id AND g.role_id=r.role_id
  WHERE a.operation_id=? AND ${CURRENT}
  LIMIT 2`;

const deny=()=>new Error('Denied: M04 synthetic cash mutation refused');

/**
 * New rows and trigger-created Cash Book rows are one SQL statement, not
 * sequential JS writes. Duplicate receipts are read only under *current*
 * SQL authority and must match original actor and exact immutable intent.
 */
export function createSyntheticM04CashAuthorityProbe(DB){
  if(!DB||typeof DB.prepare!=='function')
    throw new TypeError('Invalid D1 synthetic cash authority binding');
  return Object.freeze({
    async record_(request){
      const x=validated(request);
      const auth=[x.tokenHash,x.tenantId,x.now,x.cashSessionId,x.cashSessionId];
      try{
        await DB.prepare(INSERT)
          .bind(x.operationId,x.cashSessionId,x.amountMinor,...auth).run();
        const receipt=await DB.prepare(READ)
          .bind(x.operationId,...auth).first();
        if(!receipt||receipt.operation_id!==x.operationId||
            receipt.actor_id!==receipt.current_actor_id||
            receipt.amount_minor!==x.amountMinor||
            receipt.cash_session_id!==x.cashSessionId)
          throw deny();
        return {operationId:x.operationId,actorId:receipt.actor_id,
          amountMinor:receipt.amount_minor};
      }catch{
        // No raw SQL, unauthorized receipt, actor or internal D1 errors.
        throw deny();
      }
    }
  });
}
