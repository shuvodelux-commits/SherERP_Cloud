# M03 — Source ID issuance and posting in ONE SQLite statement (local-only proof)

**Source authority:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/Utils.gs::generateId_` and `Config.gs::ID_PREFIX.SALES='INV'`, pad length six. Depends on merged PRs #186 (legacy high-water preflight) and #194 (local D1 counter + idempotency receipt).

## Problem

PR #194 proves that a source-style ID sequence and immutable ID receipt are atomic, but **a separate business posting might fail after the ID has already been issued**, creating an orphan ID reservation and a mismatch between transaction records. This PR must prove that a missing stock unit or failing journal entry rolls back the ID receipt, ID counter, stock mutation AND journal together, while supporting retries and concurrency. The real system is NOT ready for production posting; this is an isolated local-contract proof.

## Smallest safe extension

- New `src/db/atomic-source-id-posting-proof.js`, internal, no public registration: `createAtomicSourceIdPostingProof(env,trustedTenantId).postSale_({operationId,intentHash})` reuses existing `createAtomicSourceIdIssuer` for fixed source family `SALES`, then reads back an immutable **synthetic** journal row with fixed SQL and bound tenant+operation. It checks the newly issued source ID and exact unit count; no independent read-before-write stock preflight. The schema must be installed for this proof to work; the module is **not** a general-purpose ERP transaction writer.
- New **test-only D1 schema** imports the original `SYNTHETIC_M03_ID_DDL` without editing it, then adds `synthetic_m03_post_stock`, `synthetic_m03_post_journal`, immutability triggers and a new `AFTER UPDATE` trigger on the original immutable ID receipt's initial null→issued-sequence stamp. This trigger conditionally deducts one fixed synthetic SKU (`PIPE-1`), asserts `changes()=1` inside SQLite, inserts one journal entry using the just-stamped source ID, and asserts it also wrote exactly one. It executes *during the same original ID receipt INSERT statement*, nested inside the existing counter trigger. Any stock or journal failure `RAISE(ABORT)` must roll back all changes.
- Test-only Worker path→immutable scenario maps ignore submitted bodies. New Wrangler fixture has synthetic UUID, `workers_dev:false` and zero live bindings. No production `migrations`, `src/index.js`, `src/rpc`, Cloudflare configs, original source/UI, Party ledgers or source Sheets changes.
- Test-only schema scoped to source `SALES` and a single fixed SKU/unit. This deliberately **does not** implement real FIFO, money, split tender, cash session, Party, source customer, actor session or transactions. Source-derived `INV` code and high-water seed drive the synthetic proof; future ERP posting has to be separately designed under M05/M06/M04 gate.

## Required real Workerd/D1 evidence

1. Seed tenant A at original high-water 16 and stock 2. First post returns `INV-000017`, decrements stock once, writes exactly one immutable journal; repeat with same intent returns same ID and does not double-post; changed intent refuses.
2. Emulate HTTP 503 **after commit**, retry the same operation and hash; receive `INV-000018` without a second stock/journal change.
3. On tenant A's exhausted stock, another attempted post fails and **counter remains 18** (no gap), no ID receipt/journal appended.
4. Tenant B has one unit and two concurrent operation IDs. Exactly one commits; result is `INV-000001`, no oversold stock or unused sequence.
5. Tenant C injects a journal failure *after* the counter increment and stock deduction. The entire receipt INSERT, counter, stock and journal roll back; dropping the trigger and retrying same operation yields original expected sequence.
6. Tenant D has no stock; E's counter is at `MAX_SAFE_INTEGER`; absent counter F also refuses. Tenant G may reuse tenant A operation ID without cross-tenant leakage.
7. Source ID receipts and journal are immutable. Invalid/untrusted client body cannot supply tenant/SQL/ID; no route registration in production Worker. No new third-party dependencies.

## TDD, ownership, rollback

Dedicated GitHub branch / scoped PR; docs & tests committed before implementation; observe missing-module RED under GitHub Foundation; minimally implement GREEN; exact-head CI includes original 84 source files, 36 UI includes, Node, Chromium, M02/M03/M04 local Workerd/D1, Cloudflare no-secret PR checks. Change only new files plus **one import** to M03 local integration test aggregator; avoid overwriting concurrent kernel/schema branches. **Rollback:** revert the PR, no production data/schema changes.

Future cutover requires owner-reviewed numbered migrations, tenant/session authorization, inventory/ledger posting policy, robust operation IDs and fingerprinting, per-tenant source import floors, and true transaction-level idempotency in real D1. This PR only supplies the required atomicity proof.
