# M03 Run 3 — Local clean-shop Owner handoff acceptance plan

> **For agentic workers:** Required Superpowers method: write a test first, capture RED, add only the missing synthetic test harness, capture GREEN, run affected Workerd/D1 and source checks, submit a scoped draft PR; do not merge without approval.

**Goal:** Prove that two newly provisioned local D1 businesses can each be claimed by the precisely approved, verified Gmail Owner and that each Owner can save the first original-format product without cross-shop access or duplicate effects.

**Architecture:** Compose the existing private M03 platform Worker, local Control D1 provisioning, original Shop migration runner, first-Owner Gmail login, immutable Shop grant and existing Owner Products POST route. Reuse actual production modules and disposable real Workerd D1 bindings while passing a test-signed RS256 Google credential through the existing verified-JWKS identity code. No public RPC, hosted Cloudflare APIs, production config, runtime engine changes, new schema, financial posting or historical data.

**Tech Stack:** Node test runner; Wrangler Workerd test harness; Cloudflare D1/SQLite; Hono; existing Google RS256 verifier; existing shop Product migrations.

**Spec:** [Clean-business #690](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/690), [M03 #22](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/22), [PORT-00 #699](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/699), [parallel execution rules](../../PARALLEL_EXECUTION.md).

## Twelve-sentence overview

1. M03 Run 1 in merged #722 provides local, operation-id-based business creation and readiness.
2. M03 Run 2 in merged #735 provides a local current-session business roster and retry after browser loss.
3. Neither merge proves the Owner can actually sign into the newly created shop and create a product.
4. This Run 3 will close that test-evidence gap without activating hosting or writes to any real customer database.
5. Two local Shop D1 bindings must remain distinct even when both shops allocate the same first Product source ID.
6. The business setup endpoint must publish one matching Gmail approval only after the Shop's pinned migration receipts are verified.
7. Before the approved Gmail is verified, an Owner session and Product write must be denied.
8. The signed Google ID token must be verified against a trusted locally injected JWKS fixture, exact client audience, browser nonce and exact approved email.
9. One accepted Owner session may publish the existing Shop-specific write grant but never a grant for another Shop.
10. A replayed first-product operation must return the original Product ID without extra rows; a changed-intent replay must conflict.
11. Revocation and swapped Shop D1 bindings must fail closed, preserving the unaffected second business.
12. Run 3 does not implement real purchase/POS/return posting; that work stays blocked until M02/M04/M08 and atomic shared-kernel signoffs.

## Global constraints

- Frozen Mohim_ERP source SHA: `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, unchanged.
- Base GitHub main at branch creation `f5736dbe0cf5ea930222ac43dfb6a8e2e9db290e`.
- Changes limited to `tests/integration/m03-clean-shop-owner-handoff-workerd.spec.mjs` and at most one **test-only** cryptographic fixture `tests/fixtures/m03-clean-shop-owner-jwt.mjs`, plus this plan.
- Zero modifications to `src/**`, `frontend/**`, numbered migrations, common Worker, Wrangler configs, GitHub workflows, Finance/Party/posting/Cash Session or production data.
- Do not invent new monetary or actor authority; tests exercise only current, reviewed private paths.
- No secrets, real addresses/accounts, real Cloudflare D1 writes, preview/production deployment or user impersonation.

## Acceptance and red/green

- [ ] RED: Create the integration test using a required missing local test-signed JWT helper, run with Workerd and capture the missing fixture error; the final test must exercise meaningful source authorization and D1 state, not just a mock.
- [ ] GREEN: Add only a small signing/JWK fixture for synthetic test identities; reuse existing verification rather than patching or bypassing it.
- [ ] Start Control D1 + two disposable Shop D1 bindings from existing local configuration. Install pinned onboarding migrations and the original Shop baseline. Seed a trusted synthetic Platform Super Admin session, create two businesses using the real Create/Resume endpoints and assert independently Ready, one bound Shop and one Gmail approval per shop.
- [ ] Add existing reviewed Shop Product/Owner-grant migrations locally as release-candidate fixtures; no remote migration.
- [ ] Prove wrong Gmail signed identity, wrong nonce, wrong audience and unverifiable subject are denied; correct signed Google identity creates one first-Owner membership and one granted session per intended Shop.
- [ ] Verify Owner A can POST one Standard zero-opening-stock Product via the real private Owner Worker, identical replay returns the same source ID, changed payload conflicts, Owner B has the same *local* PRD-000001 source ID in a different physical database and cannot read Owner A's catalog.
- [ ] Prove swapped binding and revoked Owner grant refuse further writes; verify no cross-Shop product row/receipt.
- [ ] Run focused Workerd RED/GREEN, full affected M03 access suite, original M01 browser if touched (none), frozen source verification, original frontend build, and full exact-head GitHub CI.
- [ ] Independent /super qa → /super review after PR; no merge without explicit owner approval.

## Review focus

1. An account with the right Gmail but an unverified signature must not claim Owner.
2. An account with a different Gmail but valid Google subject must not claim Owner.
3. Control D1 is a separate transaction boundary from Shop D1; the test must not claim atomicity across both.
4. A reused Product ID across distinct Shop D1s is allowed; source IDs must never be used alone as cross-shop identity.
5. A disabled/superseded Owner session must not silently reacquire a revoked Shop grant.
