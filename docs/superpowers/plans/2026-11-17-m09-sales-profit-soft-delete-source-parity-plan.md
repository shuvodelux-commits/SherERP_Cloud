# M09 Sales + Profit source-faithful soft-delete parity implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development. Verify RED before any production edit.

**Goal:** Make internal Sales and Profit projections treat mixed-case original soft-deletion markers exactly as frozen GAS and prevent a future misleading report total.

**Architecture:** Reuse the frozen `DeleteEngine.gs::isDeleted_` in the two independent VM-based parity oracles, then apply minimal guarded comparisons in the two pure report readers. No shared helper or new dependency.

**Tech Stack:** Node ESM / node:test; GitHub Actions; unchanged legacy GAS read-only.

**Spec:** `docs/superpowers/specs/2026-11-17-m09-sales-profit-soft-delete-source-parity-design.md`

## Global constraints
- Base `main@7c81dca09f975fbda37586eb50c2763c7f8506df`, M09-only GitHub branch, issue #431; parent #491 confirmed merged.
- Only six exact paths listed in design; no M03 protected paths or any public endpoint.
- Test original source oracle, not a reimplementation of it; all reports remain internal, inactive and unauthorized for real customer data.
- No change to money rounding, FIFO, source invoice IDs, returns, settlement or Party accounts.

## Review focus
- Mixed-case true deletion changes Sales report invoice counts/net amount.
- Mixed-case true deletion changes Profit revenue/COGS/coverage (not just visible list).
- Literal false/uppercase false, boolean false, zero and blank stay active as frozen source specifies.
- Existing duplicate Sales invoice ID detection still includes original historical rows.
- Original source and input rows remain unchanged, full CI passes.

## Task 1 — RED frozen-source parity
- [ ] Update both existing test oracles to run exact `DeleteEngine.gs::isDeleted_` extracted from pinned source.
- [ ] Add two tests per report for mixed-case true and false/blank markers.
- [ ] Commit tests + plan/spec with **no projector changes**.
- [ ] Verify a GitHub Actions full Node run proves exactly the expected mismatch in the new tests and other baseline tests pass.

## Task 2 — minimal GREEN
- [ ] Apply only the frozen `TRUE` case-insensitive comparison to source deletion checks in `sales-report-read.js` and `profit-report-read.js`.
- [ ] Confirm focused original source parity tests, full Node/source checks and full current-head Workerd/D1 + UI matrix pass.
- [ ] Confirm no source/financial path touched outside the six approved files.

## Task 3 — review and merge
- [ ] PR to main with issue, source SHA, RED/GREEN jobs, exact ownership and rollback.
- [ ] Wait for exact-head full CI and reviews; do not cancel, waive or force statuses.
- [ ] After owner-authorized squash merge, verify all paths on actual main; update #431.

**Rollback:** revert the report-only change; no D1, source data or schema migrations.
