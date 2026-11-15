/**
 * M04 compatibility-only verifier for hashes created by legacy Auth.gs.
 *
 * Source formula: lowercase-hex SHA256(UTF8(password + original UUID salt)).
 * This is NOT a password issuance algorithm. M04 must upgrade verified users
 * to a reviewed slow password KDF before enabling public D1-backed login.
 */
const SHA256_HEX=/^[0-9a-f]{64}$/;

/**
 * @returns {Promise<boolean>} True only for an exact legacy verifier match.
 * A broken/unavailable Web Crypto environment rejects; it never authenticates.
 */
export async function verifyLegacyPassword(password,storedHex,salt) {
  if(typeof password!=='string' || typeof salt!=='string' || !salt ||
     typeof storedHex!=='string' || !SHA256_HEX.test(storedHex)) return false;

  if(!globalThis.crypto?.subtle?.digest) {
    throw new Error('Web Crypto SHA-256 verification unavailable');
  }

  const bytes=new TextEncoder().encode(password+salt);
  const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  const actualHex=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  if(actualHex.length!==64) throw new Error('Invalid SHA-256 verification result');

  // Compare every character; never short-circuit on a partial hash match.
  let mismatch=0;
  for(let i=0;i<64;i++) mismatch|=actualHex.charCodeAt(i)^storedHex.charCodeAt(i);
  return mismatch===0;
}
