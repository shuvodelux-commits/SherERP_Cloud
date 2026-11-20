# M03 Run 4 — Owner-ready local Shop schema gate

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development. Capture functional RED → minimal GREEN → refactor/test before requesting independent /super qa and /super review.

**Goal:** A newly created local Shop can be marked Owner-ready only after the actual complete pinned Product, Owner-grant and first-Product receipt migrations have been atomically applied and sealed with migration and schema receipts.

**Architecture:** Preserve the three-step PORT-P2 baseline rehearsal. Add a versioned, SHA-256-pinned six-step Owner-ready candidate in a pure Workerd-compatible module. Teach only the local migration rehearsal helper to accept either of these explicit manifests, and require a matching six-step manifest at final Control D1 readiness when the new local Owner-ready policy is enabled. Extend the merged #742 two-Shop local acceptance proof so the provider itself applies the six-step plan before provisioning becomes ready; remove its post-Ready manual schema setup.

**Tech Stack:** Hono/Workers, Cloudflare Workerd/D1 SQLite, Node tests/Wrangler, existing owner Gmail/Product endpoints.

**Spec:** M03 issue #22, clean-shop #690, PORT-00 #699, prior merged #742, docs/PARALLEL_EXECUTION.md.

## Invariants / ownership

- Single M03 integrator branch from `main@fb56703fd41a942ca6adfae19af324eaab0ab66c`. No overlap with current M08 #741.
- Never modify frozen original source, existing migration SQL or public/hosted Worker routes.
- Original PORT-P2 three-step plan and callers remain unchanged by default.
- New six-step plan pins exact checksums for `0013_product_catalog_revisions`, `0002_shop_owner_write_grant` and `0003_owner_product_create_receipts`, after the baseline three files.
- The local setup flow may not publish binding + Owner Gmail approval as ready when `PLATFORM_LOCAL_OWNER_READY_ENABLED='true'` and either the profile is missing, incomplete, mismatched or migration receipts are not sealed.
- Every migration is applied with the existing SQLite batch and SHA/schema checkpoint; interruption cannot publish readiness.
- The extra Owner write grant exists but is disabled until a signed, verified Gmail session claims the Shop.
- No second migration engine, no remote D1 writes, no live Owner impersonation, no shared finance/POS/return posting.
- Preserve two-Shop identities and Product ID namespaces; don't infer multi-tenant identity from source IDs alone.

## Review focus

1. A three-step baseline must not be accepted for Owner-ready even with a successful provider callback.
2. Replaying the same six-step plan after interruption must apply only remaining steps.
3. A checksum mutation, later schema drift or swapped physical binding must block publication.
4. The empty-shop preflight must prohibit applying the clean-only Owner Product receipts on historical/canonical Product records.
5. No granted Owner write token, first Owner or Product exists before signed Google Gmail verification.

## Task 1 — Functional RED for readiness gate

**Files:** `tests/integration/port-p4-control-center-provisioning-workerd.spec.mjs`, `src/auth/port-p4-local-provisioning.js`, `src/db/m03-owner-ready-shop-migrations.js`.

- [ ] Write Workerd test that enables Owner-ready policy, supplies only valid three-step baseline plan and provider, and asserts no `ready`, no Control owner approval/binding.
- [ ] Run targeted test; confirm RED because old code prematurely publishes `ready`.
- [ ] Implement immutable six-entry manifest and exact-name/checksum matcher.
- [ ] Gate final Shop readiness in the existing private provisioning verifier by this manifest under the opt-in local flag.
- [ ] Run focused Workerd GREEN; ensure existing baseline/legacy tests remain green.

## Task 2 — Versioned migration runner and two-Shop real Owner handoff

**Files:** `tests/fixtures/port-p2-local-shop-migrations.mjs`, `tests/integration/m03-clean-shop-owner-handoff-workerd.spec.mjs`.

- [ ] RED: make #742's Owner handoff provider select the new six-step manifest, remove its manual Product/Owner migrations after Ready, assert the tables already exist immediately after Ready, Owner grant starts disabled, two signed Owners can still write first Products.
- [ ] Implement the smallest explicit plan option in the existing local runner, preserving the old default and exact migration hash/receipt schema checks.
- [ ] Validate full Workerd GREEN and repeat/idempotency, mismatch/rollback, three-step legacy and two-Shop isolation.
- [ ] Add negative fixture for incomplete receipt, modified SQL hash and restored interrupted six-step prefix without new Shop allocation.

## Task 3 — Verification and review

- [ ] Run focused + affected Workerd/D1 suites, source verification, original frontend build and full Node suite.
- [ ] Open one **draft** GitHub PR, wait for exact-head CI, document remaining hosted Cloudflare gap.
- [ ] Independent Super QA → Super Review, explicit owner merge approval only; no production deployment.
