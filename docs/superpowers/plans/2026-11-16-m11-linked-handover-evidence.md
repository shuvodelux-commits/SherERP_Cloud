# M11-10 — Linked owner handover and operations-custody evidence

Date: 2026-11-16. Tracking: #306. Production prerequisite M10 #312 is still open/unsigned. Branch base: `SherERP_Cloud/main@61ce3cd936b22386700377c7c73d38c708907b42`. Original source pin: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## 12-sentence implementation overview

1. M11-09 verifies a private post-cutover business-smoke manifest, but its acceptance does not prove that support, backups, incident response and owner handover were reviewed together.
2. M11-10 adds a small offline **cross-evidence handover consistency check** rather than new cloud infrastructure or a deployment mechanism.
3. It consumes the existing M11 switch/handover release-evidence manifest, activation cutover sequence, private smoke evidence, and multi-window incident-continuity evidence.
4. Every input must match an independently supplied exact release SHA, pinned original Mohim_ERP source SHA, and final private source-snapshot SHA-256.
5. The tool reuses the existing M11-01, M11-03, M11-08 and M11-09 validators instead of maintaining competing definitions of release, business parity or monitoring health.
6. It demands at least two contiguous monitored windows with no outstanding or previously reviewed critical incident in the submitted observation horizon, because postincident operational reopening needs a separately authorized review.
7. It rejects unresolved HTTP or latency escalation, incomplete monitoring evidence, mismatched source snapshots, and a handover review timestamp before the last monitoring window ends.
8. Its small handover record requires separate verified references for backup custody and restore rehearsal, source archive retention, incident on-call, monitoring alert routing, support handoff, accounting review and owner business acceptance.
9. It cross-links the accounting and owner-acceptance reference IDs to the corresponding handover-phase M11 release-evidence checks, preventing contradictory final signoffs.
10. Duplicate custody references, stale release pins, injected fields, missing approvals and fictional public-preview production identities will fail closed.
11. Superpowers RED tests will be committed before the checker, verified in GitHub Actions, followed by a minimal GREEN implementation, CLI and a concise runbook note.
12. The result is **documentary completeness only**: it neither authenticates references nor grants production traffic switching, restores, D1 writes, legacy write resumption or M10/M11 owner GO.

## Ownership and acceptance

- **New:** `tests/m11-handover-linked-evidence.test.mjs`, `scripts/check-m11-handover-evidence.mjs` and this plan.
- **Updated:** `docs/runbooks/M11_PRODUCTION_CUTOVER.md` only.
- **Reused unchanged:** `scripts/check-m11-release-evidence.mjs`, `scripts/check-m11-production-smoke.mjs`, `scripts/check-m11-cutover-order.mjs`, `scripts/check-m11-incident-continuity.mjs`.
- **Strictly unchanged:** Worker source/public RPC registry, original GAS/Sheets, schemas/migrations, financial posting kernel, preview/staging/production Wrangler configuration, GitHub workflows, actual cloud resources, business data and credentials.
- **RED:** missing checker module intentionally breaks new regression suite in existing pull-request CI.
- **GREEN:** exact-head `npm test` and all existing real local Workerd/D1/browser/preview workflows pass; draft PR until owner review and current-main mergeability checked.
- **Risk:** structurally matching self-reported private evidence can be fabricated; only independent operator verification and owner signoff can establish operational truth.
