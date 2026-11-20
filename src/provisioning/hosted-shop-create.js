/**
 * Option A Task 2 — durable Control D1 shop-create claim and reconciliation.
 *
 * Do not import this into public routes. A private Provisioner Worker must
 * separately verify an MFA-backed Admin session, exact account ownership,
 * authorized provider permissions, and Worker publication before Ready.
 */
import {startLocalProvisioning} from '../auth/port-p4-local-provisioning.js';
import {hashOpaqueSessionToken} from '../auth/session-token.js';
import {CURRENT_PLATFORM_ADMIN_FROM} from '../auth/platform-superadmin-session.js';
import {validatedReceipt} from '../auth/port-p2-create-attempt.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACCOUNT=/^[0-9a-f]{32}$/;
const NOW="CAST(unixepoch('subsec')*1000 AS INTEGER)";
const deny=()=>({code:401});
const selection=`SELECT j.operation_id AS operationId,j.shop_id AS shopId,
    j.account_id AS accountId,j.database_name AS databaseName,
    j.attempt_id AS attemptId,j.state,j.failed_stage AS failedStage,
    j.database_id AS databaseId,j.evidence_ref AS evidenceRef
  FROM platform_hosted_shop_create_journal j
  JOIN platform_shop_reservations r ON r.operation_id=j.operation_id
  WHERE j.operation_id=? AND r.shop_id=j.shop_id
    AND r.created_by_subject=(SELECT f.subject ${CURRENT_PLATFORM_ADMIN_FROM})`;

const stateBody=row=>({
  operationId:row.operationId,shopId:row.shopId,
  state:row.state,failedStage:row.failedStage,
});
async function scopedRow(db,hash,operationId){
  return db.prepare(selection).bind(operationId,hash).first();
}
export async function readHostedShopCreate(db,token,operationId){
  if(!UUID.test(operationId))return {code:400};
  const hash=await hashOpaqueSessionToken(token);
  if(!hash)return deny();
  const row=await scopedRow(db,hash,operationId);
  return row?{code:200,body:stateBody(row)}:deny();
}

export async function reserveHostedShop(db,token,input,{accountId}={}){
  if(!ACCOUNT.test(accountId)||!input||typeof input!=='object')
    return {code:400};
  // Reuse the existing immutable P4 intent and owner Gmail validation.
  const reserved=await startLocalProvisioning(db,token,input);
  if(reserved.code>=400||!reserved.body)return reserved;
  const {operationId,shopId}=reserved.body;
  const hash=await hashOpaqueSessionToken(token);
  const dbName='shererp-shop-'+shopId.replaceAll('-','');
  const attempt=operationId+':shop-create';
  await db.prepare(`INSERT INTO platform_hosted_shop_create_journal
    (operation_id,shop_id,account_id,database_name,attempt_id,state,
     created_at_ms,updated_at_ms)
    SELECT ?,r.shop_id,?,?,?,'reserved',${NOW},${NOW}
    FROM platform_shop_reservations r WHERE r.operation_id=?
      AND r.shop_id=? AND r.created_by_subject=
      (SELECT f.subject ${CURRENT_PLATFORM_ADMIN_FROM})
      AND NOT EXISTS(SELECT 1 FROM platform_hosted_shop_create_journal WHERE operation_id=?)`)
    .bind(operationId,accountId,dbName,attempt,operationId,shopId,hash,operationId)
    .run();
  const progress=await readHostedShopCreate(db,token,operationId);
  if(progress.code!==200)return progress;
  return {...progress,code:reserved.code};
}

/**
 * Private service entry only. A claim is persisted BEFORE the first POST.
 * All replays run findCreation, NEVER another createDatabase POST.
 * Name-only inventory matches are not receipts; unresolved => fail closed.
 */
export async function advanceHostedShopCreate(db,token,operationId,provider){
  if(!UUID.test(operationId))return {code:400};
  const hash=await hashOpaqueSessionToken(token);
  if(!hash)return deny();
  const row=await scopedRow(db,hash,operationId);
  if(!row)return deny();
  if(row.state==='database-created')return {code:200,body:stateBody(row)};
  if(!provider||typeof provider.createDatabase!=='function'||
     typeof provider.findCreation!=='function'||typeof provider.inspectAccount!=='function')
    return {code:503,body:stateBody(row)};
  const action={accountId:row.accountId,name:row.databaseName,attemptId:row.attemptId};
  let newlyClaimed=false;
  if(row.state==='reserved'){
    let capacity;
    try{capacity=await provider.inspectAccount();}
    catch{capacity=null;}
    if(!capacity||capacity.accountId!==row.accountId||
      !Number.isSafeInteger(capacity.usedDatabases)||
      !Number.isSafeInteger(capacity.maximumDatabases)||
      capacity.maximumDatabases<1||
      capacity.usedDatabases>=capacity.maximumDatabases){
      await db.prepare(`UPDATE platform_hosted_shop_create_journal
        SET failed_stage='capacity',updated_at_ms=${NOW}
        WHERE operation_id=? AND state='reserved'`)
        .bind(operationId).run();
      const latest=await scopedRow(db,hash,operationId);
      return latest?{code:200,body:stateBody(latest)}:deny();
    }
    // Every cross-process writer competes on this single D1 SQL CAS.
    const claim=await db.prepare(`UPDATE platform_hosted_shop_create_journal
      SET state='creating',failed_stage=NULL,updated_at_ms=${NOW}
      WHERE operation_id=? AND state='reserved'
      AND EXISTS(SELECT 1 ${CURRENT_PLATFORM_ADMIN_FROM})
      RETURNING operation_id`).bind(operationId,hash).first();
    newlyClaimed=!!claim;
  }
  let receipt;
  try{
    const raw=newlyClaimed
      ?await provider.createDatabase(action)
      :await provider.findCreation(action);
    if(!raw)throw Error('CREATE_OUTCOME_UNKNOWN');
    receipt=validatedReceipt(raw,action);
    await db.prepare(`UPDATE platform_hosted_shop_create_journal
      SET state='database-created',database_id=?,evidence_ref=?,
          failed_stage=NULL,updated_at_ms=${NOW}
      WHERE operation_id=? AND state IN ('creating','outcome-unknown')
      AND database_id IS NULL
      AND EXISTS(SELECT 1 ${CURRENT_PLATFORM_ADMIN_FROM})`)
      .bind(receipt.id,receipt.evidenceRef,operationId,hash).run();
  }catch{
    await db.prepare(`UPDATE platform_hosted_shop_create_journal
      SET state='outcome-unknown',failed_stage='reconciliation',
          updated_at_ms=${NOW}
      WHERE operation_id=? AND state IN ('creating','outcome-unknown')
      AND database_id IS NULL`).bind(operationId).run();
  }
  const latest=await scopedRow(db,hash,operationId);
  return latest?{code:200,body:stateBody(latest)}:deny();
}
