import {hashOpaqueSessionToken} from '../../src/auth/session-token.js';

// Test-only. The generation comes from trusted fixture orchestration.
// This is not a deployed Control-to-Shop session replication mechanism.
export async function publishFixtureOwnerGrant(DB,token,generation){
  const digest=await hashOpaqueSessionToken(token);
  if(!digest||!Number.isSafeInteger(generation)||generation<1)throw new Error('Invalid fixture Owner grant');
  const row=await DB.prepare(`UPDATE shop_owner_write_grant SET token_hash=?,generation=?,enabled=1
    WHERE singleton=1 AND generation<?
    RETURNING generation`).bind(digest,generation,generation).first();
  return row!==null;
}
