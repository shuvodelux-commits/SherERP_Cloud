/**
 * Internal M04 opaque session-token primitives (not an auth/session API).
 *
 * The client receives a 64-character lowercase hex bearer token. Future
 * server-side D1 sessions must store ONLY its digest with unique constraints,
 * explicit expiry, revocation and current user/role checks. Neither function
 * persists tokens or authenticates a request.
 */
const SESSION_TOKEN_BYTES=32;
const HEX_TOKEN=/^[0-9a-f]{64}$/;

/** Mint a cryptographically random, 256-bit bearer token in legacy shape. */
export function createOpaqueSessionToken() {
  const cryptoApi=globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues!=='function')
    throw new Error('Web Crypto secure random generation unavailable');

  const bytes=new Uint8Array(SESSION_TOKEN_BYTES);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
}

/**
 * Compute a one-way stable lookup key for a valid opaque bearer token.
 * Invalid caller input never produces a DB lookup key.
 * No matching/authorization is done here: DB session state remains mandatory.
 *
 * @returns {Promise<string|null>}
 */
export async function hashOpaqueSessionToken(token) {
  if(typeof token!=='string' || !HEX_TOKEN.test(token)) return null;

  const subtle=globalThis.crypto?.subtle;
  if(!subtle || typeof subtle.digest!=='function')
    throw new Error('Web Crypto SHA-256 verification unavailable');

  const input=new TextEncoder().encode(token);
  const bytes=new Uint8Array(await subtle.digest('SHA-256',input));
  if(bytes.length!==SESSION_TOKEN_BYTES)
    throw new Error('Invalid SHA-256 token digest length');

  return Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
}
