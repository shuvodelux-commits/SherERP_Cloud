# M03 — existing first-Shop core release refresh without downgrading D1 bindings

**Date:** 21 November 2026 (Dhaka). **Branch:** `fix/m03-safe-core-ui-refresh-release`. **Base SHA:** `c002c8390adf1796880373672ca45d3723ebf159`.

## Problem and scope — Superpowers overview

1. The latest GitHub `main` contains the merged HisabIQ Shell, Party, POS, Product Table, Settings and Dashboard UI, but the live `shererp.hisab.workers.dev` Worker is still an older version.
2. Its latest deployed version 70 was promoted on 20 November 2026 at 21:35 UTC, before these merges.
3. Every recent `main` GitHub check named `Workers Builds: shererp` reports failure and no new version was promoted.
4. The first-Shop build generator intentionally requires a protected approved SHA equal to `WORKERS_CI_COMMIT_SHA`, and rejects unapproved commits.
5. The existing core activation gate only accepts the *pre-activation* seven-blocker Shop D1 readiness report.
6. A freshly rerun, read-only Shop D1 audit of the existing activated Worker reports exactly two blockers (Cash Return and Supplier Cash Pay flags remain off), because the core Shop is already activated.
7. Reusing a stale pre-activation seven-blocker report or deleting its approval gate would both be incorrect.
8. Add a narrow separate mode `FIRST_SHOP_CORE_MVP_REFRESH` accepting **only** the exact two-blocker verified active-core report with immutable Shop and 13-receipt checks, the approved Supplier SQL overlay, and read-only core catalog confirmation.
9. The generated Worker runtime must retain the identical Control/Shop D1 IDs, Shop identity/marker, Owner origin, Google login, rate limit, assets and only the five previously enabled core feature flags.
10. Cash Returns, Supplier Cash Payments, Super Admin support audit, public RPC and general multi-Shop deployment must remain disabled.
11. The new mode must still require the exact approved 40-character production GitHub commit SHA, with a fail-closed rejection of stale, forged, extra or incomplete evidence.
12. Cloudflare Workers Builds remains the sole publisher: do not call `wrangler deploy`, change remote bindings, create/migrate D1, enable unsupported finance or bypass the restricted Builds API 403.
13. Verify the current HisabIQ assets in the generated Owner HTML, TDD RED/GREEN contracts, the real current read-only D1 report, local strict Wrangler dry-run with a private ignored candidate, and affected browser smoke tests.
14. Document the operator-only Cloudflare Build-time release-variable update and exact-SHA build so the owner can activate the UI without violating deployment ownership.

## Acceptance conditions

- Both existing initial-core `FIRST_SHOP_CORE_MVP_TEST_ONLY` and new exact-core-refresh modes are testable. Neither permit defaults to ON.
- Refresh requires `coreReadConfigured=true`, `coreWriteConfigured=false`, `supplierCashConfigured=false`, `approvedSupplierOverlayVerified=true`, approved Shop identity/schema and exact disabled Cash Return/Supplier Pay flags.
- Neither response may say `productionReady:true` or accept `CHECKS_REQUIRED`; no unknown extra D1 binding, unknown privilege flag, wrong Shop marker or changed deployment owner.
- Approved `WORKERS_CI_COMMIT_SHA` must equal protected `SHERERP_FIRST_SHOP_CORE_RELEASE_COMMIT`, unchanged from first activation.
- Use an isolated GitHub branch and PR; never change the developer's existing checkout. Keep P0 financial features unaffected.
- Local fixture, Workerd/D1 tests and Source/Chromium smoke prove only readiness; **hosted deployed latest UI is not claimed until a newly deployed Cloudflare version is verified**.
- Existing 13 Shop migrations, Admin MFA, Owner session and all financial records remain unmodified.

## Evidence recorded during the branch

- Local original five HisabIQ Owner frontend controllers successfully compiled. Current active Cloudflare Worker D1 bindings and all feature flags exactly matched the private refresh candidate. Strict Wrangler dry-run passed without upload/deploy.
- Initial proposed refresh acceptance was **RED** against the existing one-shot-only release builder; 19/19 focused build and activation contracts became **GREEN** after narrow refresh handling.
- A merged-UI Dashboard text-regression was found and locally reproduced (current Owner fallback differs from the old M09 catch). PR #882 already modifies the same Dashboard compiler and tests with a structured error code. To avoid parallel conflicts, the temporary M09 code/test fix was **reverted from this branch**. Re-run its browser checks after #882 merges; this PR makes no Dashboard UI claims.
- Existing hosted Shop prebound Workerd + private first-Shop login contracts passed 6/6; frozen original source manifest passed 84/84. Cloudflare Build History remains inaccessible (403 via authorized OAuth), so hosted build log, actual production push, browser login and release acceptance remain unverified.
- No standalone GitHub workflow is added: GitHub OAuth scope does not authorize workflow edits, and existing branch/PR checks govern merge.
