# M04 legacy password verifier — isolated design (2026-11-15)

**Status:** internal migration compatibility helper only; no live authentication, schema, secrets or deployment.

## Why this slice
The original SherERP `Auth.gs` stores a lowercase SHA-256 hex digest of the exact UTF-8 string `password + salt`, where new salts come from `Utilities.getUuid()`. Its verifier compares the computed hex with the stored value in a full-length comparison loop. M04 will eventually need to recognize verified legacy passwords before upgrading to a modern versioned slow KDF. The M03 DB/runtime and M04 session/auth gates are not complete; the helper must remain internal and independent.

## Source and constraints
- Pinned source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` at `legacy/source/Auth.gs`, specifically `hashPassword_`, `verifyPassword_`, `sha256Hex_` and `timingSafeEquals_`.
- Use Web Crypto `crypto.subtle.digest('SHA-256', UTF8(password + salt))`, available in both Workers and Node 22+. Do not use Node crypto in production, introduce dependencies, or create SHA-256 hashes for new passwords.
- The exact supplied password/salt Unicode text is significant; do not trim, lowercase, normalize, change salt format, or reverse concatenation.
- `verifyLegacyPassword(password, storedHash, salt): Promise<boolean>` returns false for malformed, missing, empty or non-string inputs. Stored digests must be exactly 64 lowercase hex characters; wrong passwords and same-prefix digests must fail. If Web Crypto is unavailable, it rejects instead of treating the credential as valid.
- Compare all 32 bytes without early-exit on digest mismatch. This is a best-effort equal-length comparison, not a formally guaranteed constant-time primitive; rate limits are still required at the eventual public endpoint.
- Return only a boolean, with no hashes, salts, messages or log lines. No caller is allowed to create a session yet.

## Approaches
1. **Selected:** dependency-free, internal compatibility verifier with synthetic, independent Node crypto vectors and source contract check. Minimal, testable and safe alongside open M04 policy PR #30.
2. Implement a complete password upgrader + D1 CAS. Deferred: shared SQL ownership, modern KDF parameters, credential schema and the atomic login boundary need separate review.
3. Activate a public legacy-SHA-256 login immediately. Rejected: unsafe before M04 rate limit, session revocation, auth policies and real D1 tests.

## File and ownership boundaries
- Create `src/modules/auth/legacy-password.js` and `tests/m04-legacy-password.test.mjs`.
- Do not modify `src/modules/auth/permission-policy.js` (owned by open PR #30), `src/db`, migrations, `src/rpc`, `src/index.js`, frontend or Cloudflare config.
- Maintain original M04 RPC 501 behavior, no live/staging D1 writes, no Party or finance effects.

## Acceptance
- RED→GREEN tests for exact SHA-256 password+UUID salt agreement, Unicode and whitespace fidelity, incorrect/empty malformed hashes, and same-prefix/suffix mismatch.
- Source contract tests must read immutable original source without changing it.
- Full `npm test`, `npm run verify:source`, `npm run build:frontend`, JS syntax and `git diff --check` pass.
- Preserve all work in a separate branch and open a **draft PR** for owner review, documenting that no real auth functionality has been activated.
