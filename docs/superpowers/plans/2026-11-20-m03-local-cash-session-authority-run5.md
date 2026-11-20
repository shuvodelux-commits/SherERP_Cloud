# M03 Run 5 — isolated Cash Session lifecycle and SQL-current authenticated boundary

**Repository:** shuvodelux-commits/SherERP_Cloud · **M03:** #22 · **M04:** #23 · **M08:** #66 · **coordination:** #456 · **M11:** #306.
**Frozen source:** Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2 (`CashSession.gs`, `Auth.gs`).
**Base:** `main@a4995ed69616ab1d3e05a675bc19d39414f94878`.
**Concurrent M03 #751** exclusively owns `src/db/m03-owner-ready-shop-migrations.js`, `src/auth/port-p4-local-provisioning.js`, `tests/fixtures/port-p2-local-shop-migrations.mjs`, and its Owner handoff/provisioning integration tests. **DO NOT EDIT THOSE FILES.**
**Also open:** M04 #745, M02 #748, M05 #750, M01 #749, M10 #746.
**Exclusive new file ownership:** this plan; `src/modules/m03-local-cash-session-lifecycle.js` (internal proof, not runtime imported); `tests/integration/m03-local-cash-session-workerd.spec.mjs`; `tests/fixtures/m03-local-cash-session-worker.mjs`; `wrangler.m03-local-cash-session-test.jsonc`; NEW isolated `.github/workflows/m03-local-cash-session-workerd.yml`.
**No changes:** shared `src/db/**`, migrations, `src/rpc/**`, public/private production Worker, existing Cloudflare bindings, Owner provisioning, source files, original UI, bank/ledger postings, or remote D1.

## Twelve-sentence implementation overview

1. The owner requests a genuine integration milestone after source-action RBAC and SQL-current authority proofs.
2. The merged M04 #737 and #738 provide respectively the local current-user session shape and the frozen `pos.add`/`pos.view` action mapping.
3. M04 #745 remains open and its test-only permissions fixture must not be copied into production.
4. This M03-owned prototype uses actual isolated M04 `auth_users/auth_roles/auth_sessions` migrations in a true local Workerd/D1 Worker.
5. It adds a separately named disposable Cash Session schema with `Starting → Open → Closing → Closed` and an SQL uniqueness guard for one unfinished session per database.
6. Start Day requires a current authenticated staff session and source-shaped `pos.add` inside the SQL session claim and resume statements.
7. Close Day also requires current `pos.add`, retains the original counted amount and reuses the same immutable close operation to recover an interrupted `Closing` state.
8. Summary requires current `pos.view`, is read-only and may report `Open` or `Closing` but cannot authorize posting.
9. The Cash-path gate requires a current authenticated actor, a valid `pos.add` test grant and `Open` session when configured ON; turning the test setting OFF does not disable staff authorization.
10. Test-only start/close markers have zero monetary value, do not fabricate cash income, and historical opening balances remain outside this probe.
11. Duplicate, wrong-actor, changed-amount, revoked-role, closing-session and late-failure attempts must not create duplicate immutable receipts or synthetic journal entries.
12. RED → GREEN → refactor → real Workerd/D1 and full GitHub CI plus M03/M04/M08/M11 independent QA precede any owner-approved merge; no public API, remote D1 or real ERP financial posting is authorized.

## Trust, lifecycle, and financial constraints

- The module is a **local-only integration contract**, intentionally never imported into live Worker/RPC. The test Worker has `workers_dev:false`, an all-zero D1 identifier, fake staff and no Cloudflare secrets.
- **Actual session lifecycle state transitions** are exercised in persisted SQLite and SQL-current M04 authorization, but the *underlying tables are synthetic*, NOT a promoted production cash schema.
- One Shop per physical D1; multi-Shop physical binding/cutover remains separately reviewed. No client-supplied Shop, actor or server clock, and no current-cash changes from mere Start/Close markers.
- Original `Closing` is discoverable for resumption, but never cash-postable; `Starting` also blocks further posting.
- All sensitive operations are bound to stable operation IDs, actor and amount, with SQL-time current permission checks and trigger-atomic receipts; no preflight alone grants a write.
- A zero-cash example is used to prove lifecycle. **Cash Book reconciliation, previous-session physical count variance, first historic opening baseline, bank transfers and actually balanced ledger stock/cash postings are NOT implemented.**
- M08 owner approved HALF_UP/integer-paisa design for new shops, but production maximum/overflow, verified unit provenance, supplier/Party lineage, discount and AR/credit classifications remain unsigned. No money writer until these gates, M04 identity and M10/M11 are separately accepted.
- Required evidence: real RED from GitHub Actions (not only a test-first commit), GREEN exact-head Workerd/D1 including interruption/Resume, role revocation, replay, and current source POS grants, no required CI failures, independent /super qa and /super review, explicit owner merge approval.
