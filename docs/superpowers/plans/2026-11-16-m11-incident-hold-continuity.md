# M11-08 — Sticky incident hold across monitoring windows (2026-11-16)

**Tracking issue:** #306; **M10 dependency:** #312 remains unapproved. **Base:** `SherERP_Cloud/main@bbb4672276b9830eb25e456384dbc6ba1117391f`. **Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Follow `AGENTS.md`, ADR-007, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md` and `docs/runbooks/M11_PRODUCTION_CUTOVER.md` before review.

## Twelve-sentence implementation overview

1. M11-05 classifies one monitoring window at a time, so a later quiet window can appear healthy despite an earlier unresolved stock, financial or D1 incident.
2. M11-08 introduces a pure, offline continuity check over a chronological sequence of existing M11-05 window manifests.
3. It requires a pinned release SHA and final legacy-source snapshot digest across every window and every recovery review.
4. Windows must be canonical UTC, consecutive without gaps or overlaps, limited in number and individually accepted by the merged M11-05 validator.
5. Any malformed or missing window turns the entire review into `INSUFFICIENT_EVIDENCE` rather than silently skipping a period.
6. A critical event or D1 error creates a sticky `INCIDENT_HOLD` that later quiet windows cannot clear on their own.
7. A recovery review can be considered only after a subsequent quiet monitoring window and only when it refers to the latest outstanding critical incident.
8. A recovery review requires separate private references for both writer freezes, the committed-write journal, gross Party account parity, inventory parity and owner review.
9. A structurally accepted recovery record yields `RECOVERY_REVIEWED`, which is *documentary* and does not authorize resuming writes or changing traffic.
10. Subsequent incidents immediately re-enter `INCIDENT_HOLD`, and unused, duplicated, out-of-order or premature review records fail closed.
11. Implement test-first in GitHub, verify the expected missing-module RED in Actions, then add only the minimal pure validator, safe private-manifest CLI and runbook guidance.
12. This never reads the actual Cloudflare Worker, D1, GAS/Sheets or private records and cannot certify evidence authenticity, operating alerts, real recovery, M10 signoff or production GO.

## Acceptance / file and contract inventory

- **Add first:** `tests/m11-incident-continuity.test.mjs` covering sticky incident, two incidents, gap/overlap, invalid metrics, stale SHA, fake review, malformed identity, unneeded review, later escalation and write resumption always false.
- **Then add:** `scripts/check-m11-incident-continuity.mjs`, with `assessM11IncidentContinuity(manifest, options)` and a CLI accepting a private JSON manifest, a release SHA and final source-snapshot digest.
- **Update:** `docs/runbooks/M11_PRODUCTION_CUTOVER.md` with operator-only evidence and sticky-hold incident instructions.
- **Unchanged:** `src/index.js`, `src/rpc/**`, `wrangler*.jsonc`, existing M11-05 semantics, CI workflows, D1 schema/migrations, accounting kernel, legacy GAS/Sheets, live business data or Cloudflare resources.
- **Risk:** A complete synthetic review remains self-reported and must not be treated as operational clearance; all outputs set `authorizesWriteResumption:false` and `authorizesTrafficSwitch:false`.
- **Gate:** exact-head GitHub checks, no conflicts against latest main, owner review and merge before any next increment.
