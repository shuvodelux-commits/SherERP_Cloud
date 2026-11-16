# M11-04 — Production candidate topology and runtime-readiness preflight (2026-11-16)

**Issue:** #306. **Target base:** `SherERP_Cloud/main@27e386c657603f05e5a5cf09f629cf5507a8b839`. **Source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Preceded by:** #309, #318 and #328. Read `AGENTS.md`, ADR-007, `docs/WORKSTREAMS.md` and `docs/runbooks/M11_PRODUCTION_CUTOVER.md`.

## Twelve-sentence implementation overview

1. The project deploys an intentionally inert `shererp-cloud-preview` Worker from `main`, and a successful deployment of that shell is not production ERP readiness.
2. Existing Cloudflare config checks enforce isolation for public preview and staging, but they do not classify a proposed *production* Worker candidate.
3. M11-04 introduces a local-only, fail-closed classifier for a proposed production topology and its reported health observation.
4. The classifier consumes exact preview and staging configs, proposed production configuration and a supplied, redacted health observation.
5. It reuses the existing validated preview and staging config contracts instead of duplicating their safety rules.
6. A candidate must have an isolated Worker identity, non-public workers.dev setting, a single distinct D1 binding and a source-faithful Worker asset routing shape.
7. The candidate must not point to the staging D1 database, re-use the preview Worker name, allow an implicit public preview database binding or accept unknown deployment fields.
8. The runtime observation must claim a connected, ready Worker for the exact proposed release SHA, not the current `foundation / not-connected` shell.
9. M11's existing prepare-phase evidence validator must also report structurally complete references, including the independent M10 owner sign-off.
10. The test suite will exercise the actual current `src/index.js` health response and actual `wrangler.jsonc`, proving that today's repository is intentionally **blocked**, alongside synthetic happy-path and negative cases.
11. The tests will be committed before the validator, with expected RED GitHub CI evidence, followed by minimal GREEN implementation and full PR CI review.
12. The result is documentary classification only, always `authorizesDeployment: false`, and performs no production provisioning, Cloudflare API call, GAS/Sheets mutation, D1 access, real data import, credential exchange or traffic switch.

## Scope and acceptance

- **Add tests first:** `tests/m11-production-candidate.test.mjs`; expected `ERR_MODULE_NOT_FOUND` before implementation.
- **Add pure validator:** `scripts/check-m11-production-candidate.mjs`, with CLI accepting only local files and fixed redacted blocker codes.
- **Update:** M11 operational runbook with exact current `NO-GO` status and proposed-topology review procedure.
- **No changes:** `wrangler*.jsonc`, `src/index.js`, PR preview/GitHub Actions deployment workflows, Cloudflare account, D1 migrations, posting/kernel, frontend, original GAS/Sheets or secrets.
- **Exit:** synthetic green, genuine current shell red, exact-head CI review, owner merge. This PR is not permission to deploy production.
