# M11-05 — Post-cutover monitoring & incident escalation preflight (2026-11-16)

**Issue:** #306. **Baseline:** `SherERP_Cloud/main@b88e6c0883f1c84ffb015b062370277babfd76ce`. **Frozen GAS source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Dependencies:** merged #309, #318, #328, #338. Read `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md`, `docs/runbooks/M11_PRODUCTION_CUTOVER.md` and ADR-007.

## Twelve-sentence implementation overview

1. M11's production runbook requires post-cutover monitoring, but it does not yet provide automated severity classification for supplied monitoring metrics.
2. M11-05 implements an offline, fail-closed incident triage report for an explicitly pinned release, final legacy snapshot and bounded UTC monitoring window.
3. It accepts only aggregated counts, a measured Worker latency value, operator-approved HTTP-error/latency thresholds and references to independently reviewed private evidence.
4. No customer or staff identity, invoice, SQL, token, mutable source data or private log payload may be embedded.
5. Missing or malformed input produces `INSUFFICIENT_EVIDENCE` instead of an apparently healthy monitoring result.
6. Any unauthorized accepted write, duplicate financial posting, gross account drift, stock drift, post-freeze GAS write or unreconciled acknowledged operation requires `INCIDENT_HOLD` independent of error-rate budgets.
7. A D1 error also requires incident review rather than assuming a completed financial transaction can safely be retried.
8. Excess HTTP 5xx rate or Worker p95 latency against an explicit, operator-reviewed threshold requires `ESCALATE` when no higher-severity accounting or security issue exists.
9. A synthetic healthy result may say `OBSERVE`, but can never authorize a traffic switch, database restore, re-enabling either writer or final M11 handover.
10. Tests must cover critical invariants, missing observations, denominator manipulation, mismatched release/checksum, invalid windows, unauthorized additional fields and severity precedence.
11. Implement the tests first in GitHub, verify their expected `ERR_MODULE_NOT_FOUND` RED, then add the smallest pure validator and a safe offline CLI for fixed-code output.
12. No Worker runtime, Cloudflare monitoring service, production alerts, D1 connection, GAS/Sheets data, deployment or financial posting behavior is changed by this PR.

## Scope, impact and acceptance

- Add `tests/m11-monitoring-triage.test.mjs` (RED), `scripts/check-m11-monitoring.mjs` (GREEN), and this plan.
- Update only `docs/runbooks/M11_PRODUCTION_CUTOVER.md` to specify data custody, operator thresholds, severity and required next actions.
- No new dependencies or modifications to `src/index.js`, RPC, `wrangler*.jsonc`, CI deploy workflow, SQL schema, finance/product/Party posting, old GAS/Sheets or actual source/business data.
- The validator is **not telemetry collection or a configured alert**; production operational readiness still requires independently verified Cloudflare dashboards/alerts, M10 signoff, source write-freeze checks and owner-approved rollback authority.
- All affected GitHub Actions checks for exact final PR SHA must pass before review and merge.
