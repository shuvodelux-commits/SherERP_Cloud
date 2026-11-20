# M02 Run 9 — two separate local Shop D1 databases: Supplier ID receipt readback

**Repository:** `shuvodelux-commits/SherERP_Cloud`; **base:** `main@fb56703fd41a942ca6adfae19af324eaab0ab66c` (merged #730 and #729; latest #744).  
**Scope:** M02 #24, clean-shop #690 and coordination #456; relevant M03 #22, M04 #23, M08 #66.  
**Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, never edited.  
**Status:** nondeployable TEST-ONLY local Workerd/D1; not M02 historical reconciliation, owner sign-off or operational SQL. Open M08 #741 and M04 auth work own separate paths.

## Implementation overview — twelve sentences

1. M02 #730 landed a pure Shop-scoped Supplier identity shape validator, but it did not prove actual D1 persistence or two separate D1 bindings.
2. M03 already owns a synthetic atomic source-ID counter and immutable replay receipt, and we must reuse it rather than invent another allocator.
3. This run binds two physically distinct disposable local D1 databases to one nondeployable test-only Workerd and seeds an original-style `SUPPLIERS -> SUP` counter in each.
4. The tests issue `SUP-000001` independently in both Shop databases and read back committed counter, operation receipt, Party and Supplier role rows directly from each separate binding.
5. The shared M02 pure validator then compares those readbacks, with no alias-by-name, phone, cross-Shop role or synthesized legacy source ID.
6. Exact operation replay must retain the same immutable ID while changed intent and attempted receipt mutation fail.
7. Concurrent Supplier ID claims must not produce duplicate sequences within the same Shop.
8. Orphan links, missing role links, inactive Suppliers and a foreign-tenant row in a Shop's private D1 must block the synthetic readback.
9. A late failure in a synthetic Party+link D1 batch must roll back both statements without leaving a fake accepted Supplier.
10. The tests deliberately demonstrate that source-ID claim and Party-link creation are **not yet one operational transaction**, so a missing link blocks readiness instead of being silently repaired.
11. All returned diagnostics are fixed codes and counts only, with private identities excluded, and the test Worker has no accessible business routes.
12. Even after green CI, M03/M04 must implement one server-authenticated, SQL-atomic Supplier creation writer before a real purchase can post; M08 monetary precision and M02 historical reconciliation remain separately gated.

## Exclusive newly added paths

- `docs/superpowers/plans/2026-11-20-m02-supplier-two-d1-readback.md` — plan and gate
- `tests/integration/m02-clean-shop-supplier-id-workerd.spec.mjs` — real disposable two-binding Workerd/D1 tests
- `tests/fixtures/m02-supplier-id-d1-readback.mjs` — test-only schema and redacted readback helper
- `tests/fixtures/m02-supplier-id-worker.mjs` — inert 404 test Worker
- `wrangler.m02-supplier-id-test.jsonc` — two synthetic D1 UUIDs only, workers_dev=false
- `.github/workflows/m02-clean-shop-supplier-id-workerd.yml` — new **PR-only no-secrets** CI job

Existing M02 shape validator, M03 issuer, original frontend, Cash Session, SQL, production Worker and M08 exact money are **read-only dependencies**, not editable paths. M03 exclusively owns `src/db/**`, migrations, operational Party schema/receipt writer and live RPC. M11/shared CI ownership gets an explicit scoped review of the new PR-only workflow.

## Acceptance and limitations

- Two Shop D1s independently issue identical formatted `SUP-000001` and show distinct receipt and Party row counts.
- Per-Shop exact source identity, immutable operation/intent and original prefix remain required; zero confusion between same names or same source IDs from different shops.
- DB constraints reject missing Party foreign keys, duplicate source links and forged receipt changes; readback rejects foreign-Shop rows and orphaned/unlinked receipts.
- Both unlinked and failed D1 batches leave **financialPostingReady:false**; no production schema/auth/account/ledger writer is added.
- Real Workerd and 404-only Worker are mandatory; no remote D1, Cloudflare provisioning, original business data import or hosted write.
- RED acceptance is test-first missing helper; GREEN is smallest schema/readback/test Worker/config plus full exact-head GitHub CI; independent `/super qa` then `/super review` and owner merge.

This is the first actual *two-binding* Supplier readback exercise, not a live tenant or accounting readiness certification.
