# M03 Canonical Operation Intent Fingerprint — Design

**Date:** 2026-11-15
**Status:** Internal M03 operation metadata prerequisite; no live posting, no production transaction schema or public RPC.

## Original and current gap
The pinned source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` stores sales and purchase facts across Sheets; there is no automatically reusable D1 request-fingerprint codec. Merged PR #49 proves synthetic D1 transaction operation IDs, committed replay vs conflict, and rollback using a `payload_hash` field, but its fixture hashes a test string rather than freezing how semantic operation payloads are encoded. Inconsistent JSON object insertion order can turn a replay into a collision; coercion of monetary floating point can alias distinct intent. An irreversible posting must use a stable contract agreed before sale/finance module integrations.

## Chosen design
`hashCanonicalOperationIntent({tenantId,actorId,operationType,payload}): Promise<64-char lowercase SHA256>` in new `src/db/operation-intent-fingerprint.js`. **Server-trusted** tenant and actor scope, type, and a JSON-shaped object payload form the hash. Serialized bytes = UTF-8 of ASCII domain prefix `SherERP:operation-intent:v1\n` followed by recursively sorted compact canonical JSON with fixed top-level lexicographic keys. SHA-256 via Worker Web Crypto. Exact string values and their Unicode codepoints are retained (no locale normalization). The digest must be identical in Node and Workerd.

- `tenantId`, `actorId`: trimmed-safe opaque IDs with conservative alphabet `[A-Za-z0-9_.:-]` and length ≤128; `operationType`: lowercase operation namespace `[a-z][a-z0-9._-]{1,63}`. All three must be read from verified server-side state / approved module, never client-asserted authority.
- `payload` must be a plain own-data object. Recursively permit only `null`, booleans, well-formed Unicode strings, safe integers (excluding -0), plain objects and dense plain arrays. Preserve arrays' order; sort object properties by ECMAScript string comparison. Reject floats (including 0.1), `Date`, `BigInt`, `undefined`, functions, symbols, custom prototypes, accessor props, exotic keys (`__proto__`, `constructor`, `prototype`), sparse or decorated arrays, circular values, invalid surrogate strings, excess nesting and >32KiB UTF-8 bytes. Amounts and fractional quantities must be **decimal strings supplied by an approved module**.
- Validate exact input keys; bound recursion and length to avoid memory abuse. Do not mutate input or stringify with lossy JSON semantics. Unavailable WebCrypto fails closed.
- No caller-provided hash can become a trusted authorization decision. A digest is a collision guard paired with a DB unique operation ID and DB-enforced posting contract; no replay success until a committed receipt is verified.

## Alternatives
1. `JSON.stringify(payload)` directly: rejects because object property order can differ and nonfinite numbers silently become `null`.
2. Call SHA256 on a client-provided string: rejects because tenant/actor/scope not included and no trusted serialization.
3. Deterministic JSON + versioned context: **chosen**, with explicit unsupported input handling. Canonical Unicode normalization is intentionally **not** performed: differing codepoints count as changed intent.
4. Schema migration or real Sales/Purchase integration now: deferred until M02/M04 and signed posting kernel readiness.

## Test and delivery
- Node `node:test` against the *real* WebCrypto implementation: independently derived digest, key order, scope binding, unicode, rejects, no input mutation.
- Nondeployable local Workerd with synthetic D1: compute digest **inside Workerd** for fixed synthetic intents; feed it to merged PR #49 `createSyntheticD1PostingContract`; verify a COMMITTED operation, REPLAY on reordered nested keys, CONFLICT on changed payload, tenant, actor and operation type with no stock/movement increase. Malformed payload fails before D1 write. No request-selected values or SQL accepted.
- No schema migration; no `src/index.js`, RPC, production D1, preview secret, GAS or UI modifications.
- Future migration must review the exact canonical serialized contract with business rules and authenticated trusted context; never claim this helper establishes complete source parity.

**Owner:** M03-core only; read `AGENTS.md`, `docs/M03_D1_TRANSACTION_CONTRACT.md` and `docs/M03_PARALLEL_READINESS.md`. `PARALLEL-MODULE-READY` remains false.
