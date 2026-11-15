# M04 — legacy salted SHA-256 verification (internal compatibility only)

**Scope:** `src/auth/legacy-password.js` exports `verifyLegacyPassword(password,storedHex,salt): Promise<boolean>`. This is a **one-way verifier for imported legacy hashes**, not a login service or a password hashing policy for new accounts.

## Exact original source contract

Immutable `legacy/source/Auth.gs` defines:
- `hashPassword_(password)`: random UUID salt from `Utilities.getUuid()`, plus lowercase `sha256Hex_(password + salt)`.
- `sha256Hex_`: `Utilities.computeDigest(SHA_256, UTF_8)` and lower-case two-character hex for every byte.
- `verifyPassword_`: calculate the same hash and compare without short-circuiting on the first different character.

The new module uses the Workers-native Web Crypto `crypto.subtle.digest('SHA-256', TextEncoder.encode(password + salt))` without trimming, Unicode normalization, reordering, case-folding or salt replacement. The comparison loops across all 64 hexadecimal characters. If a stored hash is missing, malformed, not lowercase hexadecimal or supplied as a non-string, the verifier returns false. A missing or broken Web Crypto service **rejects**, never grants access.

**Compatibility detail:** This low-level verifier can match the synthetic SHA256 hash of an empty password, as the original `verifyPassword_` could; the actual `login` function rejects empty login inputs separately. No public login endpoint has been added.

## Security and migration requirements

Raw salted SHA-256 is **not an acceptable new password-storage scheme** for a public Worker app. This helper intentionally does **not** issue passwords or hashes, store credentials, access D1, create sessions/cookies, cache results or log plaintext/hash/salt. M04 must later migrate successfully verified legacy credentials to an approved, versioned slow KDF while maintaining server-side throttle, session revocation, role permissions, last-admin protection and database transaction consistency.

The helper is not registered with `src/rpc/registry.js` or imported into `src/index.js`; every public M04 auth RPC remains 501 until the complete security design and real local Workerd/D1 tests are accepted. No real passwords or hashes are included in this repository — tests use synthetic values only.

## Tests and evidence

- Independent Node `node:crypto` SHA256 reference vectors (not self-validating against the Web Crypto implementation).
- ASCII/Bangla/emoji input, exact case/whitespace and salt preservation, wrong password/salt, tampered leading/trailing hex characters, uppercase/malformed hashes and non-string values.
- Source/RPC isolation assertions and preexisting `tests/m04-auth-preflight.test.mjs`.
- No original-source, database, Worker entry, RPC registry, Cloudflare config, migration or frontend change in this slice.

**Readiness:** M04 authorization/session/credential-upgrade implementation remains incomplete; M03 and the shared atomic posting kernel remain blocking for parallel backend business modules.
