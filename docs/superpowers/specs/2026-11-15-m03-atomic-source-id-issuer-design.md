# M03 — Atomic source-family ID issuance on isolated real Workerd/D1

**Source authority:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `Utils.gs::generateId_`, `Config.gs::ID_PREFIX` and `ID_PAD_LENGTH=6`. Build on merged PR #186, `planSourceIdCounterFloor`.

## Scope and boundaries

Implement an **internal, unregistered** atomic D1 ID issuer proving that the source-compatible next-ID sequence can be issued only once per **tenant + ID family + immutable operation intent**, even with concurrent requests, ambiguous HTTP delivery and stale source counters. This is M03-core's **isolated schema prototype**: no production/staging D1 migration or remote writes, no public RPC, no shared `src/db` file edits, no deployed Worker imports, no auth impersonation, no Cash/Bank/Party movement. Source and UI remain unchanged. Existing D1 master Catalog constraints are not yet integrated: import/cutover must freeze/reconcile original IDs first and guarantee no duplicate live IDs.

## Minimal design selected

**New module:** `src/db/atomic-source-id-issuer.js`, exporting `createAtomicSourceIdIssuer(env,tenantId)`. It accepts a *trusted server-derived* tenant ID, not client-controlled tenant/actor. `allocate_({idKey,operationId,intentHash})` accepts a source key, a stable caller-owned operation ID and a canonical hash of the intended operation; it returns `{id,sequence}`. No automatic idempotency keys, no in-process locks or request-level caches. No dynamic SQL identifiers: one fixed SQL INSERT and one fixed SELECT.

**Test-only isolated SQL contract:** `tests/fixtures/m03-id-issuer-schema.mjs` defines:
- `synthetic_m03_id_counters(tenant_id,id_key,prefix,current_sequence)` with composite PK, positive prefix, bounded safe integer and explicit floor seeded from the approved preflight. Counters cannot be auto-created by a caller.
- `synthetic_m03_id_receipts(tenant_id,id_key,operation_id,intent_hash,issued_sequence)` with composite PK, tenant/family scoped UNIQUE issued sequence and an FK to counters.
- **Single-statement SQLite AFTER INSERT trigger**: increments exactly one matching counter if below MAX_SAFE_INTEGER; otherwise `RAISE(ABORT)`; stamps the same receipt's sequence in that statement. This trigger's changes are one SQL transaction; if the stamp fails, SQLite rolls back the initial insert and increment. A duplicate `(tenant,idKey,operationId)` is prevented by `INSERT ... ON CONFLICT DO NOTHING` and **does not invoke the trigger again**. BEFoRE UPDATE/DELETE triggers make issued receipts immutable while allowing initial null→sequence stamp.
- Because SQLite's `RETURNING` reflects pre-AFTER-trigger values, the module does **not** rely on returning the insert result. After the committed insert it reads back the exact tenant+key+operation receipt joined with the trusted prefix. It validates the original intent hash and SQL result fields; a mismatched hash fails closed without advancing the counter. If D1 commits but response is lost, a retry using the original stable operation ID and hash reconciles to the same ID.

**Test-only Worker:** `tests/fixtures/m03-id-issuer-worker.mjs`, `wrangler.m03-id-issuer-test.jsonc`, fixed path→immutable server-side scenario mapping (never reads submitted body). SQLite DDL is created only by the isolated local harness in `tests/integration/m03-id-issuer-workerd.spec.mjs`. Add only one import line in `tests/integration/m03-workerd.spec.mjs` to execute the real Workerd+D1 evidence under existing PR-only no-secret CI. No production migration and no rollout.

## Acceptance

1. Original source prefix/pad and high-water floor used to seed the tests; a counter initialized at 16 issues `PCAT-000017`, `PCAT-000018`.
2. Replay same intent returns same ID without increments; same operation ID with different hash is rejected. Lost response after commit recovered by retry. Concurrent independent stable operations receive distinct continuous sequences.
3. Tenant + family scopes are separate, including the same operation IDs; missing counter and exhausted/unsafe counter refuse with no receipt. Mid-trigger injected failure rolls back BOTH counter and receipt, and a subsequent genuine retry works.
4. Receipt sequences cannot be forged, updated or deleted after issuance. Unknown routes/GET/user-provided body cannot issue arbitrary IDs. No source/UI/Cloudflare production changes.
5. TDD RED test-only commit observed missing module; GREEN only smallest implementation; full Node source+build, M01 Chromium, M02/M03/M04 local Workerd D1 and PR safety CI on exact head. This is a **synthetic local D1 contract**, not production tenant authentication, imported-ID cutover, or authorization to issue financial IDs.

**Future gating:** shared schema owner must approve table/DDL naming, actual source ID import floors and seed atomicity, legal tenant scope, M04 actor/session/permissions, client-call contracts, and checked integration into financial posting in the **same D1 atomic boundary**. Issuing an ID before posting and never using it may leave gaps; this prototype is not a substitute for atomic transaction posting.

**Rollback:** revert this branch. No remote schema/data changes.
