# M03 Run 3 — Original-ID Family/Prefix Claim Guard

**Scope:** private, nondeployable SQL-atomic source-ID issuer hardening. M03 owner #22; coordination #456; original source Mohim_ERP@`29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; depends on merged M02 Run 4 ID-floor contract #561. This is one Super Build scoped objective, not the full M03 Run 3 release gate.

## Decision and smallest safe implementation

The existing private issuer in `src/db/atomic-source-id-issuer.js` already exercises real Workerd/D1 concurrency, intent collision, replay, stock/journal rollback and source ID issuance against **synthetic** tables. Do not duplicate it or expose it publicly. However, the issuer accepted any syntactically valid `idKey` and trusted the stored counter prefix, even if that counter was from an unapproved original group or had been forged. The original Config specifies exactly 38 sequential families; `SESSIONS` is a random token and `SALE_POSTING_JOURNAL` is not a sequential ID family.

Minimal correction: `m03-source-id-families.js` pins exactly those 38 original families and their original prefixes. The Node contract test compares the entire mapping against M02's source-file/manifest-verified `M02_ID_FAMILIES`, rather than hand-waving from naming conventions. The counter prefix predicate is evaluated by SQL **within the original INSERT**, so a mismatch cannot trigger a counter increment or receipt insert. Readback also checks that the immutable receipt's counter prefix still matches the frozen source family; unknown families are rejected before preparing SQL. Existing tenant scope and operation/intent idempotency are unchanged.

## Acceptance and TDD

- **RED first:** test `tests/m03-run3-source-id-contract.test.mjs` imports a missing family module; existing real D1 Workerd spec adds a forged-prefix counter and an explicit `SESSIONS` counter, both required to be refused with no state change. GitHub PR #579 test-only head `bf4eb85ac6b13055153367725d0c38f878ec2e8b` failed the Cloudflare safety workflow in run `44094295911` / job `134077226402`: observed `ERR_MODULE_NOT_FOUND`; **3,357 pass / 1 test-file fail**. This is a test-first module-absence RED, not a claimed business-logic assertion failure.
- **GREEN implementation:** import the exact-family map, reject unknown source keys, guard both `tenant_id`, `id_key` and original `prefix` inside a parameterized SQLite claim, then verify the prefix again on readback.
- **Required full validation:** `npm test` and all six real local Workerd/D1 CI shards, including `tests/integration/m03-id-issuer-workerd.spec.mjs`, on the final PR head. Do not merge on fast-only or pending checks.

## Explicitly NOT accomplished

No original 38-family DocumentProperties evidence has been independently captured; no 49-group historical real-source import/reconciliation has been approved; no stored historical/deleted source-ID uniqueness or permanent counter-floor migration has been shipped. The permissive legacy preview helper `src/modules/source-id-counter-floor.js` is **not** an authorized real import; new M02 `buildM02IdFloorReview` is the offline reviewer. Do not infer initial counter floors from empty state, row count or SQLite rowid. M04 current authenticated actor/session and M05–M08 finalized FIFO/units/Tiles/Cash Session/Party posting remain separately blocked. The public Worker RPC registry stays empty; no staging/production database binding, financial posting, source-data modification or cutover occurs here.

## Reversal and external docs

Rollback is reverting this isolated PR on main after review; it touches no numbered D1 migration or live data. The unrelated original GAS and original UI remain unchanged.

- D1 prepared statements: https://developers.cloudflare.com/d1/worker-api/prepared-statements/ — use bound parameters, never string-interpolated family/tenant identifiers.
- D1 result objects: https://developers.cloudflare.com/d1/worker-api/return-object/ — asynchronous `.run()` returns an explicit success flag.
- Super Build: https://github.com/EricTechPro/super-board/blob/main/skills/super-build/SKILL.md — builder opens draft PR; QA/review and merge are separate.
