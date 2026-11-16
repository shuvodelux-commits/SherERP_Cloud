# M11-09 — Private production business-smoke evidence preflight

Date: 2026-11-16. Tracking issue: #306; blocked by M10 signoff #312. Base: `SherERP_Cloud/main@e05c2d07b286c6b02ef27c1698949082cf1ebe0a`. Original source pin: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Read `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md`, ADR-007 and `docs/runbooks/M11_PRODUCTION_CUTOVER.md` before review.

## 12-sentence implementation overview

1. M11 release evidence already includes a single postlaunch-smoke reference, but this does not show which preserved SherERP workflows were reviewed.
2. M11-09 adds a narrowly scoped offline validator for private, operator-supplied post-cutover business-smoke evidence without deploying or exercising live transactions.
3. It reuses the merged M11 cutover-order validator to require an approved-looking *activation* sequence and matching switch-phase release evidence.
4. It pins every smoke record to one independently provided release SHA, pinned original source SHA and final source-snapshot SHA-256.
5. It requires separate read-path records for deployed health, authenticated sign-in/out, RBAC denial, products and FIFO stock, invoice printing, daybook/reports and settings/team.
6. It requires separate synthetic-format receipt and verification references plus unique operation IDs for POS sales, split tenders, purchases, sales returns, purchase returns, cash-session enforcement and cash/bank posting.
7. All write-path records must attest to zero unexplained differences, and distinct operation/receipt IDs prevent a single smoke transaction being reused across scenarios.
8. A final independent account/stock/cash-bank reconciliation reference must state zero unexplained differences and zero unreconciled acknowledged operations after smoke.
9. A verified single-writer boundary must state one D1 authority with zero post-freeze legacy writes and no concurrent legacy writer.
10. Missing fields, injected secrets, invalid record IDs, mismatched release pins, incomplete cutover, repeated proofs or unreviewed scenarios must fail closed with only fixed diagnostic codes.
11. We will commit negative and positive regression tests first, verify their expected missing-checker RED in GitHub Actions, then commit the minimum checker, safe private-file CLI and operator runbook section and rerun CI.
12. Passing evidence checks mean structural documentary completeness only and never authenticate private evidence, authorize migration, make production ready, resume writes, or override the M10 owner GO prerequisite.

## Owned files / acceptance

- New `tests/m11-production-smoke-evidence.test.mjs` and `scripts/check-m11-production-smoke.mjs`, plus this plan.
- Append a concise use/limitation section in `docs/runbooks/M11_PRODUCTION_CUTOVER.md`.
- No edits to shared `src/index.js`, `src/rpc`, D1 schema, migrations, `.github/workflows`, preview Worker, original Mohim_ERP GAS/Sheets, business data, credentials or actual Cloudflare resource bindings.
- Private metadata retains only opaque record references, local synthetic operation IDs and verified human review status; no private payload should be published.
- Local smoke evidence is only meaningful after *real* authorized deployment, reversible controlled business operations and independent accounting review; this tool does none of those actions.
- TDD tests prove valid synthetic structure, denied cutover path, missing release GO, wrong release/deployment, incomplete reads/writes, duplicate operation receipts, nonzero discrepancies, wrong single writer and injected sensitive fields.
- PR starts draft; owner reviews exact-head CI and conflicts before merging.
