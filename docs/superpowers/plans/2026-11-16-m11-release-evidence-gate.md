# M11 — Fail-closed production release documentary gate (2026-11-16)

**Source of truth:** `AGENTS.md`, `docs/WORKSTREAMS.md` M10/M11, `docs/MIGRATION_PLAN.md`, `docs/runbooks/M04_PROTECTED_STAFF_EXPORT_AND_CUTOVER.md`. **Frozen GAS source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Base:** `SherERP_Cloud/main@920a019eaa686e84a308b927510555ee52877475`. **Issue:** #306.

## Twelve-sentence implementation overview

1. M11 cannot authorize a production cutover until M10 completes and the owner signs its readiness report.
2. The currently connected Cloudflare Worker automatically publishes an intentionally inert, D1-free shell, not the live ERP.
3. The first M11 slice is an offline documentary release preflight, not a deployment implementation.
4. A fixed phase checklist will distinguish pre-cutover preparation, the freeze/final-import traffic switch and handover.
5. Each prerequisite requires a separate evidence-reference identifier and a verified result bound to the exact release commit SHA.
6. The source commit must match the frozen baseline, and a final source snapshot needs a SHA-256 checksum before the switch phase can be documented as complete.
7. Missing M10 sign-off, unresolved Party links, insufficient recovery rehearsal or a missing owner GO must block later phases.
8. The validator will reject extra manifest fields so the document cannot accidentally carry source exports, credentials or personal information.
9. Passing structural validation means only that the referenced records are complete enough for independent human review, not that their claims were independently authenticated.
10. The runbook will require freeze of both legacy and replacement writes during rollback, followed by an exact replay/reconciliation decision before old routing is restored.
11. Tests must first fail on a missing validator module, then cover absent, stale, contradictory and complete synthetic references before implementation.
12. No production binding, SQL migration, GitHub deployment workflow, original GAS/Sheets mutation, live account export or traffic routing will be changed by this PR.

## Scope and acceptance

- **Add:** `tests/m11-release-evidence.test.mjs` (RED), `scripts/check-m11-release-evidence.mjs` (GREEN), `docs/runbooks/M11_PRODUCTION_CUTOVER.md` (operational gate).
- **No changes:** `wrangler*.jsonc`, `src/index.js`, `src/rpc/*`, source GAS, D1 schema/financial kernel, PR preview workflow or Cloudflare deployment.
- **Test contract:** Node `node --test tests/m11-release-evidence.test.mjs`; GitHub PR CI `npm test`, build, frozen-source verification.
- **Evidence restrictions:** only references and digests in manifests; real private snapshots, credentials, staff/customer data and backup contents must remain outside GitHub.
- **Approval:** draft PR until owner review and checks green; M10 and separate live cutover GO remain blocked.
