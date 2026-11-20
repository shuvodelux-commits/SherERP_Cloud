/**
 * Test-only Support Mode diagnostics. Never imported by deployed Workers/RPC.
 *
 * The trusted caller resolves a physical D1 binding; untrusted request data
 * must NOT choose scope.shopDb or influence SQL. A current Super Admin session,
 * one-Shop support grant and durable READ event are checked in Control D1
 * before any Shop catalog query. This is NOT a financial or Shop data API.
 */
import {authorizeLocalSupportRead} from './m03-local-support-read-grants.js';

const CATALOG_SCHEMA=`SELECT name FROM sqlite_master
  WHERE type='table' AND name IN ('product_categories','product_units')`;

/**
 * Report only non-sensitive catalog setup health, never operational ERP
 * readiness. There is intentionally no table name or column from a caller.
 *
 * An authorized read and its Shop query involve different databases; this
 * local proof must not be exposed as a hosted RPC without separately reviewed
 * revocation-race/permission and audit policy.
 */
export async function inspectLocalSupportShop(controlDb,scope,{eventId,sessionToken,supportToken}={}){
  let authorization;
  try{
    authorization=await authorizeLocalSupportRead(controlDb,scope,{
      eventId,sessionToken,supportToken,
    });
  }catch{
    return {status:'denied'};
  }
  if(authorization?.status!=='allowed'){
    return {status:authorization?.status==='invalid'?'invalid':'denied'};
  }

  // A successful SQL-current READ audit is mandatory before these SELECTs.
  // We intentionally do not include identity markers, names, IDs or contents.
  try{
    const {results}=await scope.shopDb.prepare(CATALOG_SCHEMA).all();
    const names=new Set(results?.map(row=>row.name));
    if(!names.has('product_categories')||!names.has('product_units')){
      return {status:'schema-incomplete',shopId:scope.shopId,catalog:{status:'missing'}};
    }
    const categories=await scope.shopDb.prepare(
      'SELECT COUNT(*) AS n FROM product_categories').first();
    const units=await scope.shopDb.prepare(
      'SELECT COUNT(*) AS n FROM product_units').first();
    if(!Number.isSafeInteger(categories?.n)||categories.n<0 ||
       !Number.isSafeInteger(units?.n)||units.n<0){
      return {status:'unavailable'};
    }
    return {
      status:'ok',
      shopId:scope.shopId,
      catalog:{status:'available',categories:categories.n,units:units.n},
    };
  }catch{
    // Never return partial counts or data on failed Shop queries.
    // The earlier READ audit remains a durable attempt record.
    return {status:'unavailable'};
  }
}
