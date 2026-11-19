import {hashOpaqueSessionToken} from '../../src/auth/session-token.js';

// Test-only. The generation comes from trusted fixture orchestration.
// This is not a deployed Control-to-Shop session replication mechanism.
export const FIXTURE_OWNER_GRANT_SCHEMA=`CREATE TABLE fixture_owner_write_grants (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  token_hash TEXT NOT NULL CHECK(length(token_hash)=64),
  generation INTEGER NOT NULL CHECK(generation>0),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1))
) STRICT`;

export async function publishFixtureOwnerGrant(DB,token,generation){
  const digest=await hashOpaqueSessionToken(token);
  if(!digest||!Number.isSafeInteger(generation)||generation<1)throw new Error('Invalid fixture Owner grant');
  const row=await DB.prepare(`INSERT INTO fixture_owner_write_grants
    (singleton,token_hash,generation,enabled) VALUES (1,?,?,1)
    ON CONFLICT(singleton) DO UPDATE SET
      token_hash=excluded.token_hash,generation=excluded.generation,enabled=1
    WHERE excluded.generation>fixture_owner_write_grants.generation
    RETURNING generation`).bind(digest,generation).first();
  return row!==null;
}
