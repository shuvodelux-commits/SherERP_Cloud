# SherERP Gate-0 — Source/Authority/Atomic D1 Integration Design

**Status:** RUN 1 REVIEW DRAFT — owner approved Run 1 execution, but **has not approved this exact interface** or Run 2 code execution. **Source of truth:** SherERP_Cloud `main@5290a06abda5a0e42192b8bfbcc2f83e59495647`; frozen Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Coordinator:** #456. **M02:** #24; **M03 sole shared integrator:** #22; **M04:** #23/#252; **security review:** #594. Updated evidence must be re-read from `main` at implementation start.

## Intent and boundaries

One original SherERP business, preserving the original GAS/Sheets UI behavior, must become a genuinely consistent Cloudflare Worker/D1 ERP without parallel double-writers, identity fabrication, amount drift or unauthorized financial effects. Gate-0 establishes a reviewed provenance/authority contract and a **private, nonfinancial** Product Category/Unit test slice before attempting live purchases or sales. Existing original UI DOM, printing, navigation and `serverCall` shape are preserved; no React rewrite or public RPC activation is authorized. M02 supplies original source groups/IDs and human-reviewed Party links; M04 supplies current staff session/actor/permission; M03 exclusively integrates shared SQL, D1 repository, RPC, source counters and atomic receipts. M05–M09 own semantic acceptance fixtures, not competing write kernels. M10 private history import and M11 production cutover remain independent owner-controlled releases.

This design must never create production D1 credentials, bind D1 to the public preview, access private source Sheets, import staff passwords, auto-net accounts, change source GAS, or turn a synthetic D1 test into a production-readiness claim. `docs/M03_PARALLEL_READINESS.md` remains **PARALLEL PREPARATION READY / SHARED TRANSACTION WRITES BLOCKED** until a separately reviewed acceptance PR demonstrates all required gates.

## Approaches considered

| Approach | Benefits | Cost/risk | Decision |
|---|---|---|---|
| **A. Reuse existing source-mapping CLI and private M03/M04 Product master bridge** | Least additional code, known original ID families, current SQL auth/receipt local tests | Still needs source/actor integration and whole-ERP proof | **Recommended design, pending independent approval** |
| B. Port all 49 groups and every business writer at once | Apparent feature coverage | Unreviewable coupled D1/stock/ledger/concurrency changes; blocks reliable parity isolation | Reject |
| C. Wire the public UI directly to isolated synthetic module functions | Early visible screens | Bypasses critical auth, trusted data and atomic posting; unsafe source-of-truth | Reject |

## Run 1 — reviewable contracts (no application code)

**Source evidence:** The existing `scripts/dry-run-source-mapping.mjs --json` produces 49 proposals and exact `sourceColumns`. `scripts/audit-migration-coverage.mjs --json` establishes 14 versioned SQL files, 19 partial schema-only groups, 30 unmapped, and 0 historical reconciliations. Link every group to its original source ID **or** source physical position, preserving raw strings, amounts, dates, soft deletions and line-order. Review the 49-row human matrix in `docs/reviews/2026-11-17-m02-operational-gap-matrix.md`; it is not imported data. Avoid a second coverage parser.

**Party/ledger:** One identity may carry Customer, Supplier, Vendor, Owner, Lender, Borrower and Payee relationships, while receivables, payables, advances, equity and loans stay distinct. No automatic name/phone matching, cross-role netting, Payee-created liability or historical-opening cash movement.

**Ownership reservation:** #603 currently covers M02 private original-row review queue, #604 covers M03 tenant counter-floor audit, #606/#607 M01 UI, #608 M08 Vendor/Payee provenance, #609/#610 M09 report/dashboard. Run 1 changes only unique docs/spec/review paths. Future M03 implementation must declare exact protected files, check all open PR heads again, and reserve one shared-path branch at a time.

**Governance:** Active ruleset `27454206` protects the default branch with one approval, stale-review dismissal, resolved threads and three named checks (`m00-audit`, `Fast PR confidence`, `Verify source, Worker and safe preview configuration`). This does *not* yet enforce every exact-head Workerd/D1, security or Chromium workflow. M11/release owner and GitHub administrator must review a minimal stable full-CI aggregator and independently verify blocking behavior before considering gate #594 complete. No unreviewed security branch or draft PR can be an exception.

## Proposed Run 2 private product-master interface — NOT YET APPROVED FOR IMPLEMENTATION

The pilot uses existing original RPC names `addProductCategory` and `addProductUnit`, only through the **internal opt-in bridge**. The public `src/rpc/registry.js` remains empty, `src/index.js` must not inject the bridge, and `wrangler.jsonc` must have no D1 binding. The private envelope is `{fnName, token, name, operationId}`; `token` represents the current bearer, `name` source-shaped text, and `operationId` an opaque stable idempotency key. Neither tenant/business, actor, server time, SQL, source ID, password, role nor permission may be accepted from the caller. The trusted server supplies `businessId`, transaction time, and frozen `PCAT` or `PUNT` original ID family.

The SQL commit boundary must evaluate tenant-matched current active session, token digest, role/version/permission `products.add`, user-disable/revocation/expiry and server clock **in the same database mutation** as counter allocation, category/unit row and immutable operation receipt. A zero-row compare-and-swap or failed check must cause no committed counter, row or receipt; rejected attempts cannot leak foreign-tenant or other-actor receipts. Idempotent same-actor same-intent replay returns the previously committed approved result; same key with altered payload or different actor/tenant denies without additional effect. Source ID floors must come from reviewed M02/M03 provenance evidence, never `MAX(id)+1` preflight. Unicode/whitespace normalization must follow frozen source semantics. Logs and HTTP output must not include staff secrets, credential material or protected D1 columns.

The proposed response shape must match the original `{success:true,data:...}` / `{success:false,message:...}` source contract, not an invented multi-tenant API. SQL-specific structures, final field signatures and source-equivalent error messages require M03+M04 review before implementing Run 2. The existing internal bridge, SQL proof, and tests are **inputs**, not fresh proof that this entire integrated contract is satisfied.

## Five negative acceptance classes for future RED→GREEN implementation

1. **Current authority:** revoked/disabled/stale actor, role edit, idle/absolute expiry or wrong tenant after a preflight read → same-SQL denial, zero effect.
2. **Source identity:** duplicate or wrong `PCAT`/`PUNT` source ID, counter floor smaller than reviewed import, repeated parent ID wrongly treated as child-row identity → fail closed.
3. **Idempotency:** duplicate click or lost response with matching actor+intent → one receipt; conflicting intent/actor/tenant → deny.
4. **Atomicity:** late SQL abort, stale CAS and concurrent operation → no partial category/unit/counter/journal state, real local Workerd/D1 test.
5. **Fidelity/privacy:** Unicode, leading zeros, malformed/deleted source text and sensitive import material → preserve or isolate for human review; no secrets, raw customer data or private source export in CI.

## Run 1 evidence and approval record

- [x] Confirm immutable source pin and current integration head, module owner boundaries, active PR paths and main ruleset configuration.
- [x] Produce 49-row M02 gap matrix from existing inventory/proposal logic, without writing migrations or claiming reconciliation.
- [x] Identify missing full-CI enforcement and independent review evidence as governance blockers.
- [ ] Obtain M02 semantic/original-ID and Party accounting review of the 49-group matrix.
- [ ] Obtain M04 security review of trusted actor/session/permission boundary.
- [ ] Obtain M03 sole-integrator approval of interface, source ID floor and planned shared-path reservation.
- [ ] Obtain M11 administrator/security review and demonstrated enforcement of full mandatory PR checks and independent Super QA/Review.
- [ ] Obtain the owner's **separate approval of this design** before Run 2 code begins.

**Run 1 outcome rule:** review-only evidence may be merged after exact-head required CI and human code-owner/review approval. Until those reviewers sign, the design is a proposal. No public D1/auth, financial posting, production import, worker binding or M10/M11 acceptance status changes result from approving Run 1.
