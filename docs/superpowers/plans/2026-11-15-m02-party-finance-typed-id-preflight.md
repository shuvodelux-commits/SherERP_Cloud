# M02-P Finance typed IDs — Superpowers test-first implementation plan

**Goal:** Block silent coercion and false duplicate detection of original Finance transaction/Person IDs in offline Party gross financial checkpoint. **Source:** Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2 FinanceModule.gs, AGENTS.md, ADR-007. **Design:** docs/superpowers/specs/2026-11-15-m02-party-finance-typed-id-design.md.

**Owns:** src/party/gross-balance-preflight.js, new tests/m02-party-finance-typed-id-preflight.test.mjs, this plan and spec. Independent of current PRs #178, #177, #174 and other modules. GitHub branch/commits/PR/Actions only; no local PC or remote database use.

## Task 1 — RED
- [ ] Read pinned FinanceModule writer and source-balance parity; write failing synthetic Node regression first.
- [ ] Cases: number Person ID matching string source ID is not authorized; number Finance ID invalid, and does not collide with valid string ID; whitespace-different string Finance IDs remain separate; null/blank IDs and exact duplicates retain prior behavior; no source-data mutation or PII leaks.
- [ ] Open GitHub draft PR and inspect Foundation RED failure names and assertions at test-only commit before production editing.

## Task 2 — GREEN
- [ ] For active finance rows, require typeof Finance ID==='string'; for undefined/null use FINANCE_ID_REQUIRED, other nonstring use FINANCE_ID_INVALID_TYPE, and trim only to check blank values. Keep original literal string map key.
- [ ] Require typeof Person ID==='string' before Party source key resolution; undefined/null use FINANCE_PERSON_ID_REQUIRED, other nonstring use FINANCE_PERSON_ID_INVALID_TYPE. Preserve exact source Person ID.
- [ ] Do not alter legitimate monetary calculations, legacy roles, deleted transactions, current vs historical opening handling, or fixed issue shapes.
- [ ] Verify focused/full Node suite, frozen 84-source checksum, original 36-include frontend build.

## Task 3 — integrated CI / owner review
- [ ] Confirm exact-head GitHub Foundation, M02 local Workerd/D1, M03 Workerd D1, M04 auth Workerd/D1, Chromium and Cloudflare safety all green; not proof of a real financial posting system.
- [ ] Compare latest main, sync nonoverlapping work if needed; exact four-file diff and zero behind before ready.
- [ ] Record RED/GREEN SHA and run IDs in PR; mark ready for review only when all checks succeed, never auto-merge. No production/staging D1 changes, original code writes or cross-role settlement.

**Release status:** Offline Party validation only. Real financial import, cutover and PARALLEL-MODULE-READY remain blocked by source, reviewer, auth and atomic posting gates.
