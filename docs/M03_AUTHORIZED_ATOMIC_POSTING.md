# M03 — D1-Atomic Authorized Posting Receipt Contract

**Status:** Test-only, synthetic schema and Worker. Not a production sales, POS, finance, Cash Session or ledger service. `PARALLEL-MODULE-READY = false`.

## Source and boundaries

Source is frozen at `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. `AGENTS.md` requires an authorized actor, proper tenant-scoped permissions, source-faithful stock evidence, stable operation IDs, DB atomicity, immutable reconciliation, and safe replay. Prior M03 PRs #49/#51/#54/#58/#61 isolated transaction, hash, receipt, reversal and session-authorized *readback*. M04 PRs #53/#55/#57 cover separate authorization checks, synthetic versions and prototype auth core. A successful read-only login/reconciliation does not authorize a later write if the session was revoked in between.

This PR proves a single **D1 SQL statement** can require current session authority to reserve a committed operation receipt, with a trigger-enforced stock decrement and inverse movement in the **same SQLite statement**, inside a single D1 batch. It does not implement any deployed financial kernel or source parity. The test-only implementation uses **one synthetic SKU, integer owned-stock units and exact decimal money strings** to isolate the concurrency and auth security property.

## Test-only interface and authenticated claim

`tests/fixtures/m03-authorized-post-contract.mjs` exports `createSyntheticAuthorizedPostingContract(DB).post({tokenHash,tenantId,actorId,operationId,units,amount,now})`.

All seven input fields are validated strictly. `tokenHash` is a SHA-256 opaque bearer digest, not a raw password or token; `now` is server clock time; the actor and tenant inputs are trusted fixture context, **not proof**. The synthetic Worker selects all values using fixed code-owned routes and ignores request bodies. A future production integration must obtain these values from authenticated Worker context, enforce the approved actual staff role and account policy, and use reviewed D1 auth tables.

- The helper hashes exact `sales.post` intent via the merged versioned SHA-256 canonical fingerprint, binding tenant, actor, SKU, units and decimal-string amount. This calculation by itself **does not grant authority**.
- The *INSERT* of `synthetic_auth_post_receipts` uses fixed bound SQL and `WHERE EXISTS` against the current, matching D1 session by token digest, tenant, user/actor ID, expiry, revocation, user/role active status, role `can_post=1`, current role association, user authorization version and role authorization version. It also verifies stock availability. A stale JS session preflight cannot override this atomic SQL check.
- A test-only SQLite `AFTER INSERT` trigger reduces stock with a one-row SQL assertion and writes one immutable inverse movement under the same receipt ID. An insufficient-stock or forced movement-insert failure causes SQLite ABORT and rolls back **all** effects. There are no multi-step JS writes between authority and inventory.
- Unique `(tenant_id,operation_id)` receipt keys prevent replay under the same operation ID. A second D1 SELECT in the same `DB.batch()` revalidates the same current session+actor and reads only the tenant's own receipt; no invalidated or different user can see another actor's receipt reference.
- `COMMITTED`: one new receipt and its stock/movement effects committed atomically; `REPLAY`: original receipt and matching hash/amount/units for that still-authorized actor, no second posting; `CONFLICT`: same actor+operation ID but changed intent, no reference; `DECLINED`: no matching authorized receipt or no stock (including revoked sessions and other actor's committed receipt), without revealing existence. Malformed batch results throw `NEEDS_REVIEW`. A D1 exception after uncertain response does not grant automatic retry.
- Role grant removal and restore, user disable and re-enable automatically bump `auth_version` via test-only triggers, preventing stale sessions from reviving.

## Actual local D1 verification

New isolated fake D1 database UUID `00000000-0000-0000-0000-000000000011`; test-only schema and seeded local tenant/role/user/session records. The fixture proves the following with real Cloudflare Workerd/D1:
- A committed receipt, decrement and movement are inseparable and are restricted to the appropriate tenant.
- Identical replay is idempotent, changed amount conflicts; another actor or forged actor cannot claim or disclose the committed receipt.
- The same operation ID may be used by two different tenants without cross-tenant leakage.
- A deliberately returned **HTTP 503 after commit** is resolved as a genuine replay with original result, not a second deduction.
- Two concurrent operation IDs competing for the final unit produce at most one committed operation.
- Late movement/journal constraint failure fully rolls back stock, receipt and movement; another valid operation can still proceed.
- Revocation, expiry, role downgrade/version change, user disable/re-enable, wrong tenant or missing actor cause the *write* to be declined.
- Committed receipt and movement records are immutable; attacker request body, arbitrary method and route cannot change SQL, actor, tenant, amount or operation ID.

The tests use both in-memory `node:sqlite` and actual local `wrangler` Workerd/D1. Targeted Node: **14 passed**; targeted Workerd: **12 passed**. Normal `tests/integration/m03-workerd.spec.mjs` imports the suite, so CI executes it with all other M03/M04 proofs.

## Critical limitations and review gates

**No deployed schema:** The existing staging contract still expects exactly **two migrations and seven application tables**. There is **no new `migrations/**`**, production D1 binding or live API. No `src/db/**` writer, `src/index.js`, RPC allowlist, Cloudflare deployment configuration, real login session, live Cash/Bank, stock, journal, Party or financial data was changed. The original GAS and UI remain untouched. Revert this PR to remove the test-only proof.

The real ERP transaction kernel must separately define customer/supplier/vendor Party obligations, per-role permissions, active Cash Session, invoice/return relationship and signed reversal, FIFO lots, OVERSOLD/vendor stock, bundles and multi-unit conversions, split tender, validated money equations, verified source evidence, resulting Cash/Bank/ledger journals, operation recovery and migration backup/cutover. The synthetic role flag `can_post` and trigger are **not** approved production models. Current PR only proves **atomic write authority** under SQLite and D1.

**Owner:** M03 posting kernel; coordinate with M02 provenance and M04 authorization owners before connecting financial modules. **PARALLEL-MODULE-READY remains false.**
