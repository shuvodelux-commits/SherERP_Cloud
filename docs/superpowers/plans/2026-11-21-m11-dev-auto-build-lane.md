# M11/M03 — opt-in automatic development build, no per-commit production refresh

## Context and owner request (21 November 2026)

The Shop Owner Worker `shererp.hisab.workers.dev` is a development/testing ERP, yet its GitHub-linked Cloudflare Builds config uses the **production SHA-pinned** `FIRST_SHOP_CORE_MVP_REFRESH` profile. Every new main merge can outdate the protected SHA and cause the build to refuse before deploying the newly merged HisabIQ UI. The owner explicitly requests stopping this repeated production-release approval during development, and restoring strict release approvals when the ERP is production-ready.

The current Worker is **publicly reachable** and bound to **existing Control and Shop D1** data. Calling it development must not bypass auth, tenant isolation, financial posting limitations, existing database schema, immutable D1 identity, or accidentally change the approved feature flags. Cloudflare Workers Builds remains the **single authorized publisher**. This PR does not itself deploy any Worker or update Build variables.

## Superpowers plan: scoped implementation

1. Add opt-in `SHERERP_FIRST_SHOP_CORE_RELEASE=DEVELOPMENT_AUTO` to the **existing** Cloudflare Builds generator, with **one-time explicit** `SHERERP_DEVELOPMENT_CORE_CONFIRMATION=EXISTING_SHOP_CORE_VERIFIED`. This is a persistent development selection, not a per-commit approval, commit pin or D1 report. The operator is responsible for first performing the already available read-only real-Shop preflight, which verified the current Shop baseline earlier; no SQL writes in this change.
2. Add TDD RED tests first: a `DEVELOPMENT_AUTO` build fails today; after the change it must produce exactly the **already approved existing first-Shop core profile** (same D1 IDs, Shop binding, OAuth origins, rate limit, 5 already-enabled core feature flags, all currently disabled money flags unchanged). It must accept the next main SHA and tolerate old protected `FIRST_SHOP_CORE_RELEASE_COMMIT` and `READINESS_JSON` values without allowing them to overwrite current core settings.
3. Reject missing/wrong one-time confirmation, wrong branch, wrong deployment owner, conflicting account, invalid Shop IDs, and unknown modes. Do not add branch previews, public financial RPC, a second deploy pipeline or new live database. Keep initial login-only and `FIRST_SHOP_CORE_MVP_TEST_ONLY` / `FIRST_SHOP_CORE_MVP_REFRESH` behavior byte-for-byte compatible.
4. Refactor only the existing safe **core flag projection** into one reusable pure helper so DEV and reviewed production modes generate exactly the same runtime flag roster. No new dependencies, database writers or Worker runtime code. Do not enable new Customer Due, split payments, Cash Return, Supplier Pay, support audit, cross-role settlement or Redemption.
5. Run contract tests, full Node test suite, `npm run build:owner-frontend`, 84 frozen-source checks, docs check, local dry-run only, and actual existing Worker binding parity against the generated opt-in DEV candidate with private in-memory values (no secrets in output). Recheck exact GitHub PR head CI and M03/M11 file ownership before merging.
6. Document one-time Cloudflare Builds Settings change: set the two development values once. Continue using existing `npm run build:owner-frontend && node scripts/build-shop-user-deploy.mjs --generate` and existing `npx wrangler@4.161.0 deploy --config wrangler.shop-user.jsonc` **from Cloudflare Builds only**, not a local/manual redeployer. Main merges then redeploy automatically *if* the existing Builds integration is correctly configured; exact Cloudflare Build failure log is not presently available to this agent. The protected mode remains available for production after separate release approval, fresh identity/schema report and SHA pin.
7. Separate broader production GO from developer convenience: no new source migrations, remote D1 changes, role grants, or financial capability activation. After every dev deployment continue smoke testing auth, signed-in UI, current Shop data and feature flags. Stop automatic dev releases and switch to production controls before actual commercial production onboarding.

## Acceptance / ownership

- M11 release controls + M03 shared generator: review required before merge. Root `PROJECT.md` updated and issue #884 tracked.
- Test-first RED → minimal GREEN with actual local tests, then exact GitHub CI and Cloudflare local dry-run.
- No live auto-release or production D1 write executed in this PR. The release mode becomes active **only after** the owner sets its Build variables in the Cloudflare dashboard, and that action is separate from merging source.
- Both existing Auth/D1 identity checks and disabled financial flags must remain unchanged; failing these checks must fail closed even in development.

## Execution record (21 November, CachyOS Node 24.22.3)

- First TDD **RED** commit `8536bf3d`: new development-auto tests failed **2** assertions (not supported mode and missing-mode fallback), while 16 existing tests passed. Existing production safety suite was not disabled.
- Minimal **GREEN** implementation: one explicit `DEVELOPMENT_AUTO` case with fixed one-time confirmation and a shared pure approved-core projection. A different simulated main SHA and intentionally obsolete production commit pin/report generated **the same approved runtime profile** as `FIRST_SHOP_CORE_MVP_REFRESH` would for the same Shop identity. Missing confirmation, bad IDs, non-main branch, unauthorized deployment owner and unknown modes reject.
- Targeted existing activation + Cloudflare Builds regression suite **29/29 PASS**.
- Full `TZ=UTC node --test`: **4,217/4,217 PASS**, 0 failed. Source manifest **84/84 PASS**, Owner app compilation and documentation checks pass.
- Read-only active Cloudflare Worker metadata `29e0fc49` was used **privately** to synthesize a development profile. New PR's existing `m11-owner-core-refresh-parity` checker returned `MATCHES_LIVE`, `authorizesDeployment=false`. Candidate remained the same after a different simulated main SHA. Strict local Wrangler `deploy --dry-run` returned zero. No remote upload, deploy or SQL write; temporary private live metadata and deploy config were deleted.
- **Actual failure cause remains unconfirmed:** Cloudflare Builds History/settings could not be read with current OAuth in the earlier audit (403). The strict SHA gate *would* reject stale pins; the build might also fail for separate npm/Cloudflare configuration reasons. Only the owner-visible Cloudflare Build log can identify which specific failure happened.

**Release review:** Human M03/M11 approval and exact-head GitHub CI still required before merge. This mode becomes active **only** after authorized one-time Cloudflare Builds variable updates. Keeping a real connected Shop D1 means the Worker is still a potentially user-accessible pilot; do not confuse development with unprotected production data.
