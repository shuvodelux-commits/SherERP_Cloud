# M11 Owner Build Safe Error Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use test-first RED → GREEN and an exact-head GitHub PR gate.

**Goal:** Identify the specific protected Cloudflare Builds preflight failure using a fixed, non-sensitive error code, without allowing any previously forbidden deployment.

**Architecture:** Retain `buildShopUserDeployment()` as the sole authorization source. On each rejection, attach a strictly allowlisted, static error `code` to the existing `TypeError`; the command-line handler prints only that code, never build values. Keep all D1 bindings, runtime flags, SHA pin checks, and Cloudflare release authority exactly unchanged.

**Tech Stack:** Node 24, Node built-in test runner, existing Cloudflare Workers Builds generator, GitHub CI.

**Spec:** Existing issue #690 and `scripts/build-shop-user-deploy.mjs` current release policy, protected build pin and active-first-Shop readiness mode.

## Global Constraints

- No automatic deploy, Cloudflare config mutation, secret disclosure, protected variable readback, remote D1 write, new financial flag, bypass of exact build SHA, or loosened readiness predicate.
- No dependency/framework additions and no changes to the Owner UI or DB posting layer.
- Document read-only live observations as evidence, never label local tests as hosted financial acceptance.

## Review Focus

- Missing or wrong `WORKERS_CI_COMMIT_SHA`: reject with a fixed SHA error code, without printing user values.
- A valid but stale protected `SHERERP_FIRST_SHOP_CORE_RELEASE_COMMIT`: reject as a pin mismatch.
- An incorrectly copied or stale readiness JSON: reject with a report/profile code, not raw JSON content.
- A mismatched Cloudflare account or invalid Shop identity manifest: reject without values.
- An unauthorized deployment-owner change: refuse early regardless of other valid build fields.

## Task 1: Introduce test-first safe codes

Files: `tests/contract/shop-user-cloudflare-build.test.mjs`, `scripts/build-shop-user-deploy.mjs`.

- [ ] Add tests showing protected SHA mismatch, missing SHA, malformed JSON, stale/mismatched report, invalid manifest and unauthorized owner currently have no specific error code.
- [ ] Execute the affected test and record the actual RED assertion.
- [ ] Attach fixed enum-like error codes to existing rejection branches; preserve the generic error-message prefix and all old rejection conditions.
- [ ] Run the affected test GREEN, existing release gate tests, and full practical Node regression.
- [ ] Commit implementation separately from RED test.

## Task 2: Preserve safe terminal diagnostics and handoff

Files: `scripts/build-shop-user-deploy.mjs`, `PROJECT.md`.

- [ ] Add an explicit test that the exception message cannot contain a sentinel secret or any provided D1/Owner identity.
- [ ] Have the CLI print only the fixed safe code, never the rejected environment values or raw caught exception.
- [ ] Document read-only live state: active Worker v`29e0fc49` predates merged `main@090c5a4b`, core flags enabled, Cash Return/Supplier Pay disabled, 13 receipts and Supplier schema verified.
- [ ] Run source/build/docs consistency, finish `git diff --check`, push one M11 PR and link it to issue #690; wait for exact-head CI.

No automatic live release is proposed. Approved Cloudflare Builds release variables still need an operator-authorized refresh and a fresh read-only readiness report; this task only improves diagnosis of why a build refuses to proceed.
