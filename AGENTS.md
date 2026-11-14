# AGENTS.md — SherERP Cloud Migration

This repository is the **target migration workspace** for https://github.com/shuvodelux-commits/Mohim_ERP. Read **docs/MIGRATION_PLAN.md** and the owner-approved **docs/architecture/ADR-007-unified-party-relationships.md** before proposing changes. Follow **docs/superpowers/plans/2026-11-14-unified-party-migration.md** for affected Party/finance modules. This file is mandatory guidance for any coding agent.

## Status and source of truth

- Project target: Cloudflare Workers, Worker Static Assets, **Cloudflare D1 SQLite**, original SherERP HTML/CSS/JS UI.
- Source of business truth: pinned SHA of Mohim_ERP/main and its AGENTS.md/PROJECT.md/source/tests. Record the SHA in an inventory artifact at M00.
- This repo is a new codebase; **the source repo, existing GAS deployment and Sheets data must not be modified or deleted**.
- Do not equate the presence of migrated .js files with a running, tested migration. Report status accurately.

## Non-negotiable architecture

- Reuse original frontend: no React/Next/Vue conversion, no styling redesign, no removal of original DOM handlers and printing.
- Preserve existing serverCall(functionName, ...args) call sites and common success/error payload shape unless contract tests justify a coordinated change.
- All RPC calls pass an explicit server-side allowlist, input validation, authentication and permissions. Never dynamically call arbitrary exported functions from client-supplied names.
- Replace GAS-only APIs with Worker/D1 abstractions: SpreadsheetApp, HtmlService, google.script.run, LockService, PropertiesService, CacheService, Utilities, Session, ScriptApp, etc. Inspect all dependencies; extension renaming alone is insufficient.
- D1 is async. Propagate await throughout dependent call graphs and ensure results cannot be silently treated as synchronous arrays/objects.
- No raw SQL from user-controlled table/column names; use parameterized values and allowlisted identifier mappings.
- Do not ship fake LockService or mock transaction semantics. D1 batch is atomic, but arbitrary JS reads and writes around it are not one transaction.
- For each financial operation define a **DB-enforced** guard and idempotent operation ID; stale preflight reads, zero-row CAS updates, duplicate submits and partial failures must never commit inconsistent stock/ledger writes.
- No hidden module-level request caches for auth, stock, cash or balances. Any future caching must have measured invalidation safety.
- No import or SQL migration against production D1 without owner-approved backup/cutover procedure.
- Cloudflare Workers Builds is the **only** deployment owner for `shererp-cloud-preview`: `main` automatically builds/deploys the inert, DB-free shell, while other branches get isolated Worker Previews. The `previews` block must stay empty; no D1, cash, bank or source-data binding may be added to publicly accessible previews. This is **not** approval to deploy a functioning production ERP.
- `.github/workflows/cloudflare-preview.yml` is a PR-only, no-secrets validation workflow, never a second deploy path. Do not reintroduce manual or push-triggered GitHub Actions deployment of the same Worker. Staging D1 migrations remain deliberately gated by separate approved controls.
- **Unified Party is approved architecture:** One Party identity may hold Customer, Supplier, Vendor, Owner, Lender, Borrower and Payee roles, but its financial accounts remain independent. Do not add a single per-Party Current Due, do not auto-net, and do not treat a Party role as a staff permission.
- **Do not auto-merge people/businesses:** Names, phone numbers, shared addresses, incomplete Person IDs and legacy aliases do not establish identity. Retain original source IDs and require human review of ambiguous links.
- **Cross-role settlement is opt-in and disabled by default:** No automatic offset, no client-authorized approval, no change to Cash/Bank/Cash Session for a pure noncash offset. Require separate eligible-pair policy, explicit authorization + approval, D1 SQL-level atomicity, per-obligation allocation, idempotency, auditable exactly-once reversal and real D1 tests before enabling.
- **Do not confuse relationships:** Owner equity is not lender debt; customer/supplier advances and vendor Due/Receivable remain separate; Payee alone never creates a payable. Historical opening amounts must not become current cash activity.

## Business rules copied from original AGENTS.md

- Products are not permanently linked to suppliers; purchases create supplier-specific lots; POS is product-based.
- FIFO: Purchase Date ascending, then Lot ID ascending (including multi-supplier lots).
- OVERSOLD lot treatment, vendor/consignment sourcing, bundles, multi-unit quantities remain intact.
- Returns/edit/delete reverse original impacts exactly once and preserve audit trails. Do not create a duplicate correction engine.
- Respect active Cash Session where the existing transaction policy applies; opening historical balances are not automatically current cash transactions.
- Validate before write, then enforce concurrency safety within the atomic SQL boundary.
- Preserve native transaction edit/delete workflows, role permission checks, authenticated actor identity, and last Administrator protection.
- Preserve existing invoice footer flow, print pagination, fixed desktop shell, mobile behaviors and horizontal table scrolling.
- One Party can have any combination of the seven roles; the new Party UI is additive and must not delete or redesign the original Customer/Supplier/Vendor/Finance/Expense workflows. Anonymous cash sales do not create Parties.

## Mandatory migration workflow

1. Start with a scoped M00–M11 workstream described in docs/WORKSTREAMS.md; branch by workstream, one objective per PR.
2. Read original source files, AGENTS.md, relevant test cases and the source SHA. Record original behaviors in tests before changing them.
3. Provide a file/RPC/table-impact inventory in every PR; indicate whether exact byte-level source was copied or mechanically transformed.
4. If changing schema, write a numbered migration, import compatibility test, and reconciliation proof. **Before creating customer/supplier/vendor/finance/payee SQL schemas, pass M02-P Party identity/role/legacy-link/account design review** and preserve original IDs and balance directions.
5. If touching sales, purchases, payments, FIFO, returns or finance, write **real D1** integration tests for atomicity, repeat replay, concurrent stale reads and rollback. Include gross per-account Party reconciliation and no unintended cross-role offset.
6. Run JS build/lint, SQL migration check, original-to-new contract tests, and affected Playwright flows. Clearly distinguish mock tests from real Workers+D1 tests.
7. Never mark DONE until acceptance criteria in MIGRATION_PLAN.md are satisfied with linked evidence.
8. Do not merge or deploy financial migrations without owner review and a documented rollback/roll-forward procedure.
9. Do not implement/enable manual cross-role settlement until **M08-S** policy, authorization and accounting gates are approved; record proposer/approver/reason and verify no Cash/Bank movement for pure offsets.

## Repository organization

- frontend/raw: preserved original HTML/CSS/JS (with provenance)
- src/index.js and src/rpc: Worker entry and explicit RPC registry
- src/modules: ported business logic
- src/db: D1 repository and mapping
- src/runtime: GAS compatibility helpers
- migrations: versioned D1 SQL
- scripts: source audit, deterministic import and UI build
- tests: unit, API contract, real D1 integration, browser E2E

Do not generate placeholder features as if production complete. If a module is not migrated, expose it as unavailable in staging or fail predictably without accidental writes; do not silently redirect only some flows to live Sheets.

## Multi-agent / parallel coordination

- Parallelize independent UI build, schema review, and source audit only after M00 contracts are recorded.
- Assign **single ownership** of shared database repository, schema migrations, and atomic posting core. Other workstreams consume versioned, reviewed contracts.
- Open PRs against migration repository only. Keep original Mohim_ERP unmodified.
- Dependencies: M00 -> M01/M02; **M02-P Party contract/schema before party/finance-dependent M02/M03/M05/M08** -> M03 -> M04/M05 -> M06 -> M07/M08 -> M09 -> M10 -> M11. Optional M08-S settlement comes **after** approved policy and full auth/posting gates, not automatically as part of schema migration.
- Follow source ownership, no simultaneous blind code generation into shared files.

## Platform documentation

- https://developers.cloudflare.com/d1/worker-api/d1-database/
- https://developers.cloudflare.com/d1/reference/migrations/
- https://developers.cloudflare.com/workers/static-assets/binding/
- https://developers.cloudflare.com/d1/reference/time-travel/
