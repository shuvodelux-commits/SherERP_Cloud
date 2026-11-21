# M11 — Existing Owner core, asset-only refresh safety

> Superpowers implementation: reproduce RED → minimal implementation → GREEN → full tests → GitHub PR exact-head CI and M03/M11 shared-code review.

## Goal / current evidence

- Issue #884: merged HisabIQ modules remain absent from the hosted Shop Owner ERP. `main@d3d77cc32cae83406dfe6383018a0c39cd06cc29` includes #893 POS and #894 Party and builds the 2,074,861-byte Owner app. The current hosted `shererp` Worker is **still** older version `29e0fc49-74be-458e-bef1-3ab42546fc05` deployed 07:54 UTC before the UI merges.
- A fresh SELECT-only Owner Shop D1 preflight confirms Shop identity, 13 migration receipts, reviewed Supplier Cash overlay, core read flags true; Cash Return and Supplier Cash Pay false; productionReady=false. No two-Shop acceptance or full financial parity approval.
- Cloudflare Workers Builds is the **sole** production publisher; local Wrangler OAuth does not have verified Builds Configuration rights. Never deploy via a second Wrangler channel, auto-merge, update a protected Build variable, enable financial flags, upload D1 or ship secrets via repo/CI.

## Task 1 — Prevent incomplete refresh configuration from silently selecting login-only

Files: `scripts/build-shop-user-deploy.mjs` (M03 shared release builder, M11 review), `tests/contract/shop-user-cloudflare-build.test.mjs`.

- Add RED tests for a partially supplied protected core refresh: a saved release SHA or readiness report with omitted `SHERERP_FIRST_SHOP_CORE_RELEASE`. Such a profile must **fail closed** with a fixed safe `RELEASE_MODE_REQUIRED_FOR_CORE` code instead of returning the login-only D1 configuration that disables existing Purchase/Cash POS.
- Preserve fully explicit login-only bootstrap only when no core refresh inputs are present, and require the existing approved mode, exact 40-digit commit pin and live two-blocker report for active-core refresh. No change to approved candidate output.
- Run affected tests GREEN; don't enable any financial operation.

## Task 2 — Exact active Worker parity preflight (read-only operator tool)

Files: `scripts/m11-owner-core-refresh-parity.mjs`, `tests/contract/m11-owner-core-refresh-parity.test.mjs`.

- Build a pure static comparator that accepts current Wrangler **versions view** JSON, proposed generated refresh profile and expected exact SHA; never logs full bindings, UUIDs, OAuth fields, Shop data or evidence. Verify exact roster and values for all runtime plain_text flags, both D1 database bindings, one Owner rate limiter and assets binding. Reject duplicates, extra bindings/secrets, changed Shop/Google origin/marker, wrong route/profile, financial flag escalation or core feature downgrade. No database reads or writes.
- CLI accepts two regular local 0600 files and exact SHA pins and prints **only static status/error codes**; reject symlink inputs and malformed arguments. Full cryptographic identity comparisons happen locally in memory, with no remote requests.
- Local preflight is **not** deployment authorization; it only checks that the candidate matches the currently active single-Shop runtime. The real build must have separately approved exact-SHA protected variables, fresh D1 evidence, backup/restore proof, security signoff and signed-in acceptance.

## Task 3 — Verify / publish

- TDD RED and GREEN evidence retained; run Owner frontend build, 84-file source manifest, docs checks, `git diff --check`, release tests and full Node suite. Perform Wrangler synthetic `--dry-run` **only**, no Worker uploads.
- Push independent GitHub branch and open PR linked to #884 and #690, require M03/M11 reviews and exact-head CI. No production deploy, no D1 mutation, production remains NO-GO.
- After human approval and separate protected Cloudflare Builds release, check actual active version and authenticated Owner UI at 320/390/768/1024/1440; rollback only Worker version if contract mismatch, never restore D1 blindly.

## Execution evidence (read-only, current live Worker)

- **RED:** on `main@d3d77cc3`, the missing comparator import and incomplete-refresh rejection tests produced **2 failures / 14 unaffected passes**. Changes were added only after RED.
- **GREEN:** affected build/comparator contracts **20/20 pass**; safe CLI matched the real active Worker with `MATCHES_LIVE`, `authorizesDeployment=false`, `productionReady=false`; disabled Cash Return and Supplier Pay remain unchanged.
- The current approved protected refresh candidate was synthesized locally **from the actual live version** plus a fresh SELECT-only readiness report, pinned to reviewed GitHub `main@d3d77cc3` using the existing M03 generator. No runtime binding mismatch was found.
- `npm run build:owner-frontend` succeeded on current main (2,074,861-byte Owner ERP HTML); pinned source verifier **84/84**. `wrangler deploy --dry-run --config wrangler.shop-user.jsonc` exited zero on the strictly private local generated profile, and the temporary repo-root config was removed. The dry-run did not upload assets, modify bindings, deploy a version, or write D1.
- The actual Build Settings API remains owner-scoped and previously returned 403 to current OAuth; this review does not claim that Cloudflare Builds settings have been fixed. The active Worker remains `29e0fc49` at 100%, deployed 07:54 UTC, prior to merged UI #893/#894. `productionReady=false`.
- Completion requires separate human/operator acceptance, exact final main SHA pin, approved Build variables, a fresh live readiness report, backup/restore & M11 review, deployment in the sole Cloudflare Builds channel, post-deploy signed-in functional screenshots, identity/flag/binding readback. **Do not use the local generator/dry-run as a deployment permit.**
