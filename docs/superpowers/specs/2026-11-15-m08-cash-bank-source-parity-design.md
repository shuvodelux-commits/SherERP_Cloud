# M08 Cash Session and Bank Transfer Golden Behavior — Design

**Scope:** Isolated synthetic-only regression characterization after merged M08 source inventory PR #67. Source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` remains immutable.

## Problem and choice

The existing M08 AST inventory captures calls and sign invariants but cannot show actual calculated session totals, historical-opening exclusions, transfer legs, or early rejection behavior. Until M03/M04/M06 close the posting gates, enabling real finance mutations would be unsafe.

**Approaches considered:** (a) port live D1 financial writes now: rejected (dependencies incomplete); (b) invent a JS replacement calculator: rejected (could disagree with source); (c) execute only selected **frozen GAS functions** inside a test-only, restricted Node VM, with synthetic rows and instrumented stubs: selected. This establishes source behavior expectations, not transaction atomicity.

## Contracts to characterize

1. Session summary starts strictly after its Cash Book **Session Open** row, not by business date. Backdated activity posted later counts.
2. Historical Opening may contribute to total current cash balance, but never current session cashIn/cashOut; entries already linked as reconciliation explanations are excluded from session turnover.
3. Closing reuses its stored expected figure, ignores its own Day Close Adjustment, reports counted cash, and never synthesizes cash through the summary.
4. The public summary path uses **active** cash rows so deleted entries do not count. Without a session marker, no prior cash is counted as current-session activity.
5. A valid bank-to-bank transfer emits exactly one transfer header plus two opposing, equal-value, same-reference Bank Book writer calls; it does **not** call Cash Book. Permissions and session guards are checked before mutation; inactive/same/missing accounts and invalid amount fail before mutation.
6. All test data is synthetic, BDT amounts use the original `roundMoney_`, and source IDs remain distinct.

## Interface and limits

Files owned: one isolated VM loader under `tests/fixtures/`, one node:test suite, and Superpowers spec/plan. No `src/**`, `migrations/**`, frontend/RPC, workflows, Cloudflare bindings or `legacy/**` edits. The VM loads only explicitly named functions from frozen source and has no filesystem, network, or application services available. Captured writer calls are **stubs**, not real SQL transactions or an implementation of atomicity. The work cannot enable cash, bank, session or cross-role posting. Future M08 real-D1 writes require the reviewed shared M03/M04/M06 posting interface and full fail/retry/reversal tests.
