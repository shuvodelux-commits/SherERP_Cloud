# M01 follow-up — Super Board frontend-skill audit plan

**Date:** 2026-11-17  
**Issue:** [#558](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/558); M01 baseline issue #25 already closed; parallel coordinator #456.  
**GitHub-first branch:** `m01/superboard-frontend-audit-20261117` created from `main@2f1639cfcc3f5ae1fd0b8f60bede44218a7e2896`.  
**Read-only browser audit baseline:** `main@40f6ae4b9cb6f17bbd6fed72a3455ba356ffed02`.  
**Pinned source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.  
**Scope:** M01 *original* frontend shell / UI presentation and static print QA across login, authenticated synthetic Dashboard/POS V2, mobile More, phone/tablet/desktop/landscape. No redesign, no source/runtime change.  
**Exclusive write paths:** this plan and `docs/reviews/2026-11-17-m01-superboard-frontend-audit.md`.  
**Protected paths:** `legacy/source/**`, `src/db/**`, `src/rpc/**`, Worker, migrations, financial posting and auth. Any remediation requires separately reviewed original-source/M03 ownership and Superpowers RED→GREEN tests.  
**Execution mode:** existing Super Board `ui-refine-loop` is a **single-route/component** Claude/Codex workflow. This request covers the full M01 module, and the target repo has no installed `.claude/skills/ui-refine-loop/SKILL.md` or `docs/super-qa/queue.md`. Therefore perform a scoped multi-surface manual `ui-refine-loop` assessment using Impeccable audit methodology and local Chromium screenshots, **not** claim actual dispatcher/5-round UI rewrite or a formal before→after visual grade.

## Owner-approved implementation overview (12 sentences)

1. Respect M01 closure and treat this as a new owner-requested audit, not evidence that live ERP backend integration is ready.
2. Review Super Board's current `ui-refine-loop` contract and apply its separation of inspect, findings, changes and finish-review evidence.
3. Derive candidate surface contexts from the frozen original HTML/CSS/JS and the repository's current frontend build scripts.
4. Read the latest `AGENTS.md`, parallel ownership rules and M01 acceptance matrix before any file writes.
5. Use a temporary, disposable GitHub clone for *read-only* source/build/browser testing, because the owner's local machine has no existing SherERP_Cloud checkout.
6. Run the current exact-source verifier, compiled frontend build and M01 Chromium regression suite and save their actual outputs.
7. Inspect generated screenshots across compact phone, normal phone, coarse landscape, tablet and desktop; never fabricate logged-in production data.
8. Probe deterministic keyboard focus, accessible names, HTML document language/title, responsive overflow and interactive target geometry.
9. Separate confirmed accessible-behavior defects from intentional fail-closed `RPC method not migrated` responses.
10. Score Impeccable's five technical categories conservatively with an explicit confidence limitation where performance and theming are unmeasured.
11. File a reproducible GitHub issue for confirmed user-visible defects; do not modify frozen production UI or shared M03 infrastructure during an audit-only run.
12. Create a documentation-only PR with the report, evidence, owner handoff, rollback, and exact-head full CI gate; do not merge it before review.

## Execution evidence / verification contract

- Local GitHub shallow clone SHA `40f6ae4b9cb6f17bbd6fed72a3455ba356ffed02`; no changes made to the original clone; no secrets, production users, production D1 or live Sheets.
- `npm ci --ignore-scripts --no-audit --no-fund --prefer-offline` completed; `npm run verify:source` verified **84** original files; `npm run build:frontend` completed.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:m01:browser`: **77 tests passed, 0 failed** on temporary clone.
- Compiled `dist/index.html` raw bytes: **1,532,314** (not compressed-transfer or Core Web Vitals).
- Live Chromium probes for public login at **320×640, 375×812, 390×844, 812×375, 768×1024 and 1440×900**: none had horizontal overflow; all lacked document language and title and their visible login labels had no programmatic association.
- Real synthetic Clerk mobile More focus probe: initial focus remained on opener, Tab traversed overlay controls then escaped to background shell even though the open sheet declared `aria-modal="true"`. Escape did close and restore focus to More.
- Source code/screenshot review done locally; audit-specific screenshots and temporary log files were **not** pushed into the repository, to avoid binary and sensitive data churn. Already-reviewed [M01 CI artifact](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44067616253) remains a separate comparator.
- Report confidence is strongest for login/mobile More, guarded POS V2 shell, mobile/desktop/print test coverage; not for real migrated data, fully authenticated business pages or physical printer hardware.

**Merge gate:** all exact-PR-head required checks, independent reviewer, no conflicts, and verified report on `main`. **Rollback:** revert the two Markdown additions only.
