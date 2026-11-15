# M04 — legacy password verification compatibility design

**Status:** standalone internal compatibility primitive only. The public `login` RPC, D1 user/session schema, password upgrade/write policy and live authentication remain disabled.

## Source contract and scope

Immutable `legacy/source/Auth.gs` computes `sha256Hex_(password + salt)` with `Utilities.computeDigest(SHA_256, ..., UTF_8)` and compares the resulting **lowercase 64-character hex digest** with `timingSafeEquals_`. Original salt is generated as `Utilities.getUuid()` and must not be normalized, trimmed, regenerated, or concatenated before the password.

The approved migration must verify existing imported hashes **once** as a prerequisite to replacing them with a separately reviewed stronger password KDF. Implement `verifyLegacyPassword_(password, storedHex, salt): Promise<boolean>` (exported as `verifyLegacyPassword`) using standard Worker Web Crypto `crypto.subtle.digest` and an equal-length fixed-iteration comparison. Use no dependency, database, source-code eval, cache, external API or logging.

Malformed stored hash/input returns false without revealing the account or hash. A missing Web Crypto implementation rejects instead of incorrectly authenticating. The helper must not emit new salted SHA-256 password hashes, supply login/signup, assign admin roles or issue bearer tokens.

## Boundaries and acceptance

- Support exact source concatenation and UTF-8 behavior for ASCII, Bengali and emoji passwords, preserving case, spaces and empty-string behavior at the **raw verifier** level. The external login flow separately denies empty credentials.
- Require a valid **lowercase** SHA-256 hex hash (source output); uppercase, truncated or nonhex stored input fails closed rather than being silently normalized.
- Reject non-string password/salt/hash without coercion; later API validation enforces input shape before calling the primitive.
- Test against independent `node:crypto` SHA256 vectors including corrupted first/last byte and wrong salts/passwords.
- No `src/index.js`, `src/rpc`, `src/db`, migrations, Cloudflare config, original source or frontend changes.
- No statement of production-readiness, D1 password migration, throttling or secure sessions. M04 remains incomplete until independently reviewed real Workerd/D1 auth security tests pass.
