# M10 Run 2 — Cross-gate packet/replay continuity handoff

**M10 owner only • Issue #312 • Coordination #456 • 2026-11-17.**
**Pinned source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Current authorization:** **NO-GO** for any private source capture, staging/production D1 write, live GAS/Sheets mutation, financial posting, or cutover. The current public Worker remains inert/D1-unbound.

## What this new guard solves

`M10-15` already checks a supplied frozen source → D1 → backup → restored chain plus gross Party accounts and numeric performance.
`M10-16` already checks separately supplied original source → first import → repeated import → rejected retry readback for 49 groups.
**Before this M10-17 handoff, both could independently report candidate status for completely different synthetic data sets.** Reviewers must not combine the two green reports without proving they are mutually consistent.

`assessM10ReplayPacketContinuity({packet,replay})` consumes their **original supplied inputs**, calls both existing validators, and then requires:
- Exactly the same 49-group row count, SHA-256 row digest and legacy ID (or `LOGS` original physical-position) commitments between replay-source and M10-15 stable source.
- Same repeated-import D1 readback as the source-to-backup rehearsal D1 summary.
- Same rejected-retry D1 readback as M10-15's pre-restore backup summary.
- Replay source capture is timestamped at/after the M10-15 second source-freeze pass; replay's post-rejection readback precedes or coincides with backup capture.
- Cross-packet freeze/replay/backup/restore capture identifiers are not reused. Duplicate IDs, mismatched groups or impossible sequence are blocked.
- Both inner M10-15 and M10-16 gates are individually candidate-ready; **no missing source, Party, performance, restore, retry or coverage component is silently accepted**.

The result contains only fixed sorted issue code/count summaries and candidate flags, never source rows, IDs, amounts, group names, digests, input capture IDs or private operator paths. Even two mutually consistent synthetic packets return:
`authorizesImport:false`, `authorizesPosting:false`, `authorizesRestore:false`, `authorizesCutover:false`, `productionReady:false`.

## Reproducible synthetic CI check

```sh
node --test tests/m10-replay-packet-continuity.test.mjs
```

Acceptance tests cover identical data candidate; two individually valid but mutually unrelated sets; `LOGS` physical positions; stale original source versus freeze; rejected retry occurring after claimed backup; cross-packet capture ID reuse; missing/failing one inner gate; M02 zero-coverage flags; hostile getters/extra private fields; deterministic redaction and no input mutation.

This pure module is **not** a new import/reconciliation operator and has no new CLI, new D1 binding, source export, storage path or authentication interface. An authorized private M10 operator can use it as a final cross-check **after separately executing** `scripts/m10-evidence-packet-check.mjs` and `scripts/m10-import-replay-check.mjs` in the approved private environment. Do not put real source summaries or the unredacted input JSON into GitHub/PRs/CI.

## Current real-data blockers and module owners

| Blocking gate | Verified current state / next owner |
| --- | --- |
| Original source-of-truth Google Sheet/DocumentProperties | M02 Gate-0 found only metadata-level candidates, none confirmed as the current authoritative 49-group original; **owner must explicitly identify and authorize** private read-only export and backup |
| All source groups/operational SQL coverage | Last canonical 14-migration audit: **49 original groups; 19 schema-only/partial; 30 unmapped; 0 original groups independently source→real D1 reconciled**; M02 source semantics → M03 exclusive schema and import owner |
| Source-ID floors and private D1 ID issuance | M02 #603 and M03 #604 merged as isolated preparation; M03 #614 and #616 are active independent atomic synthetic D1 proposals, not public approval |
| Gross Party, FIFO/OVERSOLD, Cash/Bank, returns, auth | M02/M04/M05–M09 supply reviewed source-linked real local D1 posting/parity evidence via M03 integrator |
| Private rehearsal and backup/restore | Only explicit owner authorization and independently captured real D1 readback/restore permit M10 #312 to run the genuine source-to-D1 comparison |
| Governance & release | M11 #306 / issue #594 independent review protection and written owner GO; no CI-only auto-merge or M11 cutover |

### Stop conditions

If either inner packet is incomplete, if the continuity guard reports any mismatch, if source authority cannot be verified, if 49/49 real group reconciliation is absent, or if the operator cannot prove source/D1 witness independence, **stop and record NO-GO**. Do not fabricate `fullyReconciled:49` or relabel synthetic captures as a source-data migration.

**No production acceptance checkbox in M10 issue #312 may be marked complete based solely on this module or its CI.**
