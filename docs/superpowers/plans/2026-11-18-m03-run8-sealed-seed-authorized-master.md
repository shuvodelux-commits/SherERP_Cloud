# M03 Run 8 — Private Sealed Counter Seed → Authorized Product Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use Superpowers executing-plans and test-driven-development, then independent Super QA → Super Review. This is a private integration acceptance proof, not an operational ERP writer.

**Goal:** Verify a single disposable local D1 state accepts sealed original-source evidence, seeds 38 original ID floors through Run 7 and then permits current M04 SQL-authorized PCAT/PUNT creation above those exact floors with replay/denial and immutable source evidence.

**Architecture:** Reuse existing 49-group `run5Evidence` and `run7Db` test facilities, original schema `migrations/0001_core_catalog.sql`, frozen M03 ID tables/triggers, current M03+M04 authorized master fixture, M04 auth schema, Run 7 installer, and M04 authorized writer. Use **one SQLite connection**; drop the simplified Run 6 *test* ID tables and recreate them with the existing full synthetic issuer DDL **before installing**, so the exact same original ID counters are used for both seed and issuance. Add no custom production adapter or second issuer. Test only in automatically-run `npm test`, then require original M03 real Workerd/D1 suites as regression gates.

**Tech Stack:** Node native SQLite test runner, exact existing Cloudflare local Workerd/D1 CI, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-17-shererp-gate0-integration-design.md`; historical source pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Owner M03 #22, dependency M04 #252, coordination #456, release security #594.

## Constraints
- Base `main@826f63662588f2961d70a7e0859b6e5fa94516ae`; verify fresh main and open PRs before implementation/merge.
- M03 exclusive shared-SQL integrator. Only change this plan, `tests/m03-frozen-source-readback.test.mjs` and the existing final case of `tests/integration/m03-frozen-source-readback-workerd.spec.mjs`; do not edit `src/db`, actual migrations, `src/rpc`, `src/auth`, Worker/production Wrangler or GitHub Actions.
- This is **a characterization/integration acceptance test** of already-merged implementations, not a new production feature. If it succeeds immediately, that is a useful seam verification, **not fabricated RED→GREEN**. If it fails because real interfaces differ, record the concrete RED and repair only the missing independent behavior through test-first scoped code.
- Never treat synthetic 49-group/38-family fixtures as custody-approved source-data migration. `independentSourceCaptureVerified`, `sourceToD1Reconciled`, `idIssuanceAuthorized`, `publicRpcEnabled` and `productionReady` remain **false**.
- All source IDs and initial counters are synthetic. Never read private GAS/Sheets or commit real source records.

## Review Focus
1. A Run 7 seed with *separately frozen source property high-water above row-max* must create PCAT/PUNT **above the property floor**, not MAX(catalog ID)+1.
2. The master writer must stamp original actor identity from current SQL session and allow same-actor exact replay without a second source ID.
3. Different actors, invalid sessions, or malformed permissions must not disclose or mutate a receipt.
4. Seeding all 38 must be atomic and not leak into any public Worker or production D1 configuration.
5. The 49 frozen source group rows must stay unchanged after private Product master creation (historical source archive is not the mutable operational catalog).

---

### Task 1 — Evidence-driven combined Node SQLite integration regression

**Files**
- Modify: `tests/m03-frozen-source-readback.test.mjs`
- Read only: `tests/fixtures/m03-id-issuer-schema.mjs`, `tests/fixtures/m03-m04-authorized-master-schema.mjs`, `tests/fixtures/m04-auth-migrations/0001_auth_core.sql`, `migrations/0001_core_catalog.sql`.

**Interfaces**
- `createM03PrivateSourceFloorInstaller(env,'TENANT-A').installFreshSynthetic_({idEvidence,freezeManifest})`.
- `createM04AuthorizedProductMasterCreator(env,{businessId:'TENANT-A'}).createCategory_({token,nowMs,operationId,name})` and `createUnit_(...)`.
- Original result `{success:true,data:{id,name}}`; original counters `PCAT` and `PUNT`.

- [ ] Write exactly one new test: `M03 Run 8 private sealed ID seed composes with SQL-authorized PCAT PUNT issuance and replay`.
- [ ] Reuse `run5Evidence()` and fresh `run7Db()` (49 sealed source groups); replace only the two simplified *test* ID tables with existing `SYNTHETIC_M03_ID_DDL` before seed; install frozen all-38 tenant floors and verify no source ID issuance authorization.
- [ ] On the SAME Node SQLite connection add the existing reviewed Product master and M04 auth schemas, then M03/M04 synthetic master triggers, seed one synthetic trusted Administrator account/session, and import the frozen PCAT/PUNT master rows while preserving original ID and physical row number.
- [ ] Assert generated IDs follow `max(original source historical sequence, frozen property counter) + 1`, stable same-actor replay returns unchanged counters and intent/receipt counts, and frozen source archive record counts/checksums remain identical.
- [ ] Run `node --test tests/m03-frozen-source-readback.test.mjs` and inspect output. Fix test setup errors, do not modify production SQL merely to make a test pass. A behavior regression requires real RED→GREEN and a narrow M03-owned follow-up.

### Task 2 — Same-state REAL Workerd/D1 source-seed to authenticated issuer integration

**Files**
- Modify: `tests/integration/m03-frozen-source-readback-workerd.spec.mjs` final fifth case only (do not add or remove test cases; M03's six-shard CI relies on this exact spec membership).
- Reuse: `SYNTHETIC_M03_ID_DDL`, `SYNTHETIC_M03_M04_AUTHORIZED_MASTER_DDL`, `createM04AuthorizedProductMasterCreator`. Apply no production schema change or new test Worker.

- [ ] After the final Run 7 installer succeeds in the original sealed 49-group Workerd database, replace only its still-empty preliminary receipts schema with the exact existing synthetic ID receipts/triggers. Keep the **same 38 seeded counter rows**.
- [ ] Activate the existing master actor-stamp trigger and use already-migrated local auth and Product master tables. Import ONLY synthetic original PCAT/PUNT category/unit master rows with original physical positions and canonical IDs.
- [ ] Seed a synthetic current M04 Administrator session, create category and unit in **the same D1** through M04 SQL authority; assert new source IDs strictly above frozen property floors, actor-stamped immutable receipts and same-token exact replays consume no further IDs.
- [ ] Assert unknown and revoked bearer denial, zero extra counters/receipts, all 49 sealed groups unchanged and no public RPC route. Keep `publicRpcEnabled:false`, `idIssuanceAuthorized:false`, `productionReady:false`.
- [ ] Verify actual Workerd via already-required M03 shard-6 in full GitHub Actions; inspect exact test names/results. If real D1 produces a different behavior than native Node, record platform RED and fix only the narrow issue under TDD.

### Task 3 — Full CI and security verification

**Files**
- No additional code changes unless a confirmed behavior gap requires a separate RED→GREEN patch.

- [ ] Run `npm test` through GitHub Foundation, plus full 44 current-head workflows (including M03 six Workerd/D1 shards, M04 security and M01 browser smoke).
- [ ] Verify changed file list, current head and no production D1 bind or public Product master RPC activation.
- [ ] Obtain independent Super QA and separate Super Review, M03 owner / M04 security review and GitHub human approval, all for exact head. No automatic merge.
- [ ] Update coordination #456 with exact evidence and limitations. Keep PR draft if any gate is pending.

## Outcomes
- **Success:** local private seed-to-issue composition verified without any new operational writer. Source-to-D1 reconciliation still 0/49 for private actual business data and no production ERP status change.
- **Failure:** record exact failing test and gate; stop merge until corrected. This plan does not authorize release, remote D1, original spreadsheet changes, cross-role settlements, sales or financial posting.
