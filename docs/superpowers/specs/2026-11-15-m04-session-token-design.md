# M04 opaque session token primitives — internal design (2026-11-15)

**Status:** independent internal auth preparation only. No login endpoint, persistent session, expiry policy, schema, or deployment change.

## Purpose and source
SherERP GAS `legacy/source/Auth.gs::generateToken_` generates an opaque 64-character lowercase hex bearer token by concatenating two hyphen-stripped UUIDs, and stores the raw bearer token in the legacy `SESSIONS` sheet. The Cloudflare/D1 M04 contract requires **hashed token storage** (not raw bearer tokens), server-side revocation and D1-backed validation. The exact session expiry/idle policy and D1 schema remain unapproved.

Pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `Auth.gs` blob `f1c0895e33eb89430337b752692d0023797b7d21`. Never import live bearer tokens or staff secrets into test fixtures.

## Alternatives
1. **Selected:** internal Worker-native token minting and one-way SHA-256 digest helper with synthetic tests. Stateless primitives can be developed while shared DB/session gates are blocked.
2. Create D1 `sessions` table and login/logout now. Rejected: shared schema owner, session expiry, last-admin, permission and throttle reviews still blocked.
3. JWT/session cookie-only authority. Rejected: conflicts with server-revocable opaque-token requirement.

## Contract
- `createOpaqueSessionToken(): string`: use `crypto.getRandomValues` for 32 independent random bytes and render exactly 64 lowercase hex characters. Never use `Math.random`, timestamp, counter, UUID concatenation or process-global cache. A missing/broken Web Crypto RNG throws; do not fall back.
- `hashOpaqueSessionToken(token: unknown): Promise<string|null>`: require an exact 64-character lowercase hex bearer token before hashing; return `null` for invalid inputs. Compute lowercase hex SHA-256 of the exact UTF-8 bearer string via Worker-native `crypto.subtle.digest`; throw if Web Crypto is unavailable/invalid. It produces **only the digest**, not a token or session.
- Token format retains legacy client compatibility (64 hex characters) while improving entropy over 2 UUIDs. Existing GAS sessions are **not** automatically reused/migrated.
- Token hashes are proposed for future D1 lookup. The future `sessions` writer must enforce a unique hash constraint and expiry, rotation/revocation and actor/role validation under server-side D1 controls; this helper does not persist anything.

## Files / boundaries
- New `src/auth/session-token.js` and `tests/m04-session-token.test.mjs`.
- No `src/auth/legacy-password.js` edits (already merged PR #31), no `src/modules/auth/permission-policy.js` edits (pending PR #30), `src/db`, SQL migrations, `src/rpc`, `src/index.js`, frontend, Cloudflare config or source snapshots.
- No client identity, staff role, Party account or financial operations touched.

## Acceptance
Independent test vectors verify exact token shape, uniqueness in a synthetic batch, deterministic SHA-256 digest, rejection of malformed input, Web Crypto missing/failure denial, no fallback RNG and unchanged public RPC gating. RED→GREEN is observed before commit.

Run full `npm test`, `npm run verify:source`, `npm run build:frontend`, new JS syntax checks and `git diff --check`. Open a separate draft PR after local checks; no merge or public activation. M04 remains incomplete.
