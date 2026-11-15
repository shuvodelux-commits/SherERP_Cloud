# Superpowers TDD — Source-Gated Gross Party Rehearsal

Date: 2026-11-15. Source: frozen Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2. Spec: docs/superpowers/specs/2026-11-15-m02-gross-source-rehearsal-design.md.

## Task 1: RED first
- Create design, plan, and `tests/m02-gross-source-rehearsal.test.mjs` only; **do not implement** the new `src/party/gross-rehearsal-gate.js` module.
- Build original complete five-master fields from checked-in pinned schema inventory and source-shaped synthetic fixture. Both reviewed and candidate copies must agree. Use reviewed synthetic approval claim fixture, and synthetic FINANCE_TRANSACTIONS original 20-column rows and trusted declared row count.
- Assert clean stage output contains zero private IDs/amounts, original gross checkpoint **counts** only; all input data immutable.
- Assert party source mismatch, two identically truncated master exports, incorrect original headers, missing/unreviewed identity decisions; finance source truncated despite full remaining rows, missing Amount/header, invalid active Finance Amount, duplicate IDs and incomplete declared count: skip gross stage with null statuses/counters.
- Assert independent gross failures (vendor negative direction, unsupported Finance transaction type, wrong finance Person source ID, incompatible source-specific Finance role) produce only redacted fixed-code reason counts. Soft-deleted Finance transaction records don't generate checkpoints; empty Finance export with explicit zero count is valid.
- Commit RED, open draft GitHub PR, and obtain actual Foundation CI **expected ERR_MODULE_NOT_FOUND** for absent module before adding any implementation.

## Task 2: GREEN minimal
- Add only the new pure `src/party/gross-rehearsal-gate.js`. Reuse validated source and gross preflight functions; no new identity algorithm, balance calculations, amount handling or database queries. Aggregate fixed stage/code counts and return only public-safe metadata, no raw Party/Finance preflight results. Sanitized generic exceptions.
- Commit GREEN and verify exact-head tests. Refactor only if proven necessary.

## Task 3: Finish verification
- Run/inspect exact-head GitHub Actions: Foundation full Node suite, frozen GAS source inventory 84, 36 original frontend includes, M02 Party real Workerd/D1, M02 reviewed readback local D1, M02 synthetic import and local staging, M03 real local D1, M04 authentication, M01 Chromium, Cloudflare no-secret PR checks. List exact statuses and test counts; distinguish queued/running from successes.
- Confirm exactly four newly added files, no edits to other workstreams and no overlap with concurrent gross-ID or D1 readback PRs. Update PR with RED/GREEN hashes and evidence. Remain draft/unmerged for owner.

No production data, account settlement, netting or cutover. Rollback by reverting PR.
