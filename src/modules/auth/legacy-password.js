/**
 * Internal-only M04 compatibility verifier for GAS Auth.gs's salted SHA-256.
 *
 * The pinned GAS source hashes UTF-8(password + original UUID salt). This
 * helper verifies only existing legacy credentials; it MUST NOT be used to
 * generate new password hashes or authorize a public RPC/session.
 *
 * No DB, network, caching, logging, mutable globals or plaintext output.
 */
const SHA256_LOWERCASE_HEX = /^[0-9a-f]{64}$/;
const DIGEST_BYTES = 32;

export async function verifyLegacyPassword(password, storedHash, salt) {
  // Fail closed on malformed imports and untrusted argument types.
  if (typeof password !== 'string' || !password.length
      || typeof salt !== 'string' || !salt.length
      || typeof storedHash !== 'string' || !SHA256_LOWERCASE_HEX.test(storedHash)) {
    return false;
  }

  // Reject a misconfigured runtime; never infer an accepted credential.
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') {
    throw new Error('Web Crypto SHA-256 unavailable');
  }

  const input = new TextEncoder().encode(password + salt);
  const actual = new Uint8Array(await subtle.digest('SHA-256', input));

  // Crypto implementations conforming to SHA-256 return exactly 32 bytes.
  if (actual.length !== DIGEST_BYTES) throw new Error('Invalid SHA-256 digest length');

  // Compare all bytes. This avoids a first-mismatch short circuit but is
  // not a substitute for a reviewed login throttle and server-side policy.
  let difference = 0;
  for (let i = 0; i < DIGEST_BYTES; i++) {
    const expectedByte = Number.parseInt(storedHash.slice(2 * i, 2 * i + 2), 16);
    difference |= actual[i] ^ expectedByte;
  }
  return difference === 0;
}
