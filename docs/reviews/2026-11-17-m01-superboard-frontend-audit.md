# Super Board frontend audit — SherERP Cloud M01 (original UI)

**Date:** 17 November 2026  
**Status:** **Audit performed; source changes NOT implemented**. This is an independent, bounded follow-up to completed M01 issue #25, not a reopening of its existing source-preservation QA signoff.  
**Findings issue:** [#558 — login semantics and mobile More keyboard focus](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/558) (**open**, awaiting an authorized source/compiled-UI fix).  
**Super Board source:** [`ui-refine-loop` skill](https://github.com/EricTechPro/super-board/blob/main/skills/ui-refine-loop/SKILL.md), related [`super-qa`](https://github.com/EricTechPro/super-board/blob/main/skills/super-qa/SKILL.md).  
**Exact methodology used:** Manual, multi-surface Impeccable **audit**/bounded review following Super Board's inspect/check/record/finish evidence principles. The upstream `ui-refine-loop` is designed for **one page/component**, requires an installed local skill, active development server, workflow/subagents and before/after screenshots. This repository has no `ui-refine-loop` installation and the user asked for all M01, so **the autonomous five-round checker/fixer loop was not actually launched**. No after-state screenshot or fix grade is claimed.  
**GitHub source of truth:** audit clone `main@40f6ae4b9cb6f17bbd6fed72a3455ba356ffed02`; this reporting branch started from later `main@2f1639cfcc3f5ae1fd0b8f60bede44218a7e2896`. Original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` remains pinned and unchanged.  
**Ownership guard:** [AGENTS.md](../../AGENTS.md), [parallel rules](../PARALLEL_EXECUTION.md), [M01 acceptance report](2026-11-17-m01-final-acceptance.md), [coordination #456](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/456). Only this report and [M01 Super Board plan](../superpowers/plans/2026-11-17-m01-superboard-ui-audit.md) are changed.

## 1. Scope and what was actually run

The inspected **Operate-mode** surfaces are (a) the original public/unauthenticated sign-in UI, (b) the synthetic authenticated dashboard shell and mobile More dialog, (c) synthetic POS V2 on 320px phone, 768px tablet and 1280px desktop screenshots, (d) preserved A4/58mm/80mm/JPEG print QA screenshots/tests, and (e) test-only fail-closed RPC. These are **not** live authenticated tenant workflows. Some page bodies depend on M03/M04/M05–M09 APIs and remain unavailable on the public Worker. Backend failures reported as `RPC method not migrated` are intentional and not frontend UI bugs.

| Executed evidence | Observed result |
| --- | --- |
| GitHub-only source snapshot and local temporary read-only clone | `40f6ae4b9cb6f17bbd6fed72a3455ba356ffed02`; original host project folders not changed |
| `npm run verify:source` | **84 verified source files** |
| `npm run build:frontend` | **Pass**, `dist/index.html` **1,532,314 raw bytes** |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:m01:browser` | **77 passed / 0 failed** in local Chromium (58.7 seconds); no extra production D1/auth action |
| Existing [M01 exact-head GitHub workflow](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44067616253) | Previously **77/77 browser tests passed** with Day Book and M04 isolated Workerd/D1 browser runs; existing screenshot artifact, separate from this local audit |
| Six live Chromium public-login viewport probes | 320×640, 375×812, 390×844, 812×375, 768×1024, 1440×900: **0px document-level horizontal overflow** at each; correct login controls rendered |
| Playwright accessibility snapshots | `#loginMobile`: `textbox "e.g. 01700000000"`, `#loginPassword`: `textbox "Your password"`, **not** their visible labels |
| Synthetic Clerk mobile More keyboard probe | Open: initial focus stays on More opener **outside dialog**; Tab moves to backdrop, Close, a menu entry, then escapes to `body` and underlying header/app controls while `aria-modal=true` |

**Visual review:** Inspected browser-produced images `mobile-320-login.png`, `original-auth-nav-phone-375x812.png`, `original-auth-nav-posv2-phone-320x640.png`, `original-auth-nav-posv2-tablet-768x1024.png`, `original-auth-nav-posv2-desktop-1280x800.png`. POS V2 remains recognizably the original operational interface across these widths; 320px tab/search/cart grouping is compact but usable in the synthetic no-product state. Expected red `RPC method not migrated` toast reflects inert backend, and no real sale was posted. Screenshots reflect source tests, **not** a fresh production tenant or before/after redesign comparison. Local image/log bytes were not committed.

## 2. Provisional Impeccable technical audit score

Scores are **0–4 per dimension**, provisional and only for the audited M01 surfaces. This is not a WCAG certification, complete all-page visual grade, measured Core Web Vitals or a literal Super Board `ui-refine-loop` score.

| Dimension | Score | Evidence and limitation |
| --- | ---: | --- |
| Accessibility | **1/4** | Three confirmed P1 gaps: missing page language/title, unbound visible login labels, modal keyboard focus escapes |
| Performance | **2/4** | Static build passes, but 1.53MB raw compiled HTML warrants compression/parse profiling; no network waterfall or Core Web Vitals benchmark yet, so this is a low-confidence neutral score rather than a verified slow-page bug |
| Theming | **3/4** | Original stylesheet has consistent root palette tokens and brand treatment; only sampled light appearance, no full contrast/dark-mode audit (dark mode not assumed required) |
| Responsive design | **3/4** | Six tested login viewport sizes have no document-level overflow; POS V2 phone/tablet/desktop Chromium QA passes; dense real-data screens not available for complete audit |
| Implementation integrity | **3/4** | Pinned 84-file original source, fail-closed adapter, no framework redesign, browser/print tests; remaining semantic gaps and backend-only E2E blockers are explicitly isolated |
| **Provisional total** | **12/20** | *Acceptable with specific high-priority accessibility fixes; not a production release score* |

**Integrity verdict:** PASS for preserving the product-specific original shell and isolating unsupported backend operations; **FAIL for accessibility completeness** until issue #558 is resolved. The scores must be rerun after an approved fix and with genuine authenticated data states.

## 3. Verified findings and severity

### P1 / Accessibility — Document language and title are missing

**Evidence:** `legacy/source/index.html:2` contains plain `<html>` rather than an explicit `lang`; no `<title>` is present in its head. In Chromium across all six viewport probes `document.documentElement.lang === ""` and `document.title === ""`. This impacts assistive-technology language selection and prevents users from distinguishing the application in browser tabs / history / accessibility navigation.

**Standards:** WCAG **3.1.1 Language of Page** and **2.4.2 Page Titled**.  
**Suggested minimal remedy:** Owner-approved `$impeccable harden`: set a deliberate primary language (e.g., `en`) and descriptive product title in the compiled original HTML contract, apply `lang="bn"` to Bengali text runs when needed, add deterministic tests. Preserve original branding and runtime behavior.

### P1 / Accessibility — Visible login labels do not label their inputs

**Evidence:** `legacy/source/login.html:9–16` renders `<label>Mobile Number</label>` and `<label>Password</label>` as siblings rather than label-associated controls; fields have IDs but labels lack `for`. All viewport probes observed `HTMLInputElement.labels.length === 0` for `#loginMobile` and `#loginPassword`. Playwright accessibility snapshots use example placeholders as names instead of the visible field labels.

**Impact:** Screen reader and voice-input users hear/match the wrong labels, especially on the mobile phone field whose current accessible name is an example number.  
**Standards:** WCAG **1.3.1 Info and Relationships**, **3.3.2 Labels or Instructions**, and relevant accessible-name patterns.  
**Suggested minimal remedy:** Owner-approved `$impeccable harden`: set `for="loginMobile"` / `for="loginPassword"` and browser-test names with `getByRole(...,{name:...})`; no form redesign or authentication contract change.

### P1 / Accessibility — Mobile More declares modal but lets keyboard focus escape

**Evidence:** `legacy/source/index.html:275–278` defines `#mobileMoreSheet` with `role="dialog" aria-modal="true"`. `openMobileMore_` in `legacy/source/javascript.html:632–646` unhides it but does not send focus inside. In synthetic authenticated Chromium at 375×812, `document.activeElement` remains the More nav button outside the dialog. Tab reaches the overlay backdrop and a close/menu entry, then **escapes to the underlying body, menu, date, calculator, refresh and dashboard quick actions**, while the dialog is still open. The Escape listener exists and correctly closes the sheet; initial and cycling focus are the specific defects.

**Impact:** Keyboard/screen reader users can act on background controls despite a visually modal sheet and inconsistent `aria-modal` promises.  
**Standards:** WCAG **2.4.3 Focus Order**, keyboard operability and ARIA modal dialog authoring guidance.  
**Suggested minimal remedy:** Owner-approved `$impeccable harden` or scoped `$impeccable adapt`: focus first usable dialog control on open, prevent background focus/interactions while shown (inert or proper focus scope), trap Tab/Shift+Tab among dialog controls, restore to More on close, preserve Escape and role-filtered items. Add Playwright keyboard/touch RED→GREEN regression at phone/landscape sizes; do not edit shared M03 runtime without approval.

### P2 / Performance investigation — Single compiled HTML size

**Evidence:** `wc -c dist/index.html` returned **1,532,314 raw bytes** after a successful original frontend build. This is only a payload/parse-size **review lead**, not measured slow startup. Compression, caching, browser CPU parse time, external font fetch and actual network transfer are **not measured** in this run.

**Suggested next diagnostic:** `$impeccable optimize` only after authorized performance profiling on 320px-class device and local/staging Worker static assets. Do not split the pinned include architecture or redesign as an unproven optimization.

## 4. Positive findings and what was intentionally not called a bug

- M01's regression suite passed **77/77** on a fresh snapshot; frozen source manifest verification passed **84/84**, with no local source edits.
- 320px, 375px, 390px, 812px landscape, 768px tablet and 1440px login layouts had **no document-level horizontal overflow**.
- Login's phone input target was measured **46px tall**, password **46px**, Show control **44px** and Login **52–54px** at sampled phone widths; this is strong touch usability for the observed sign-in state.
- The mobile More dialog **does close on Escape** and restores opener focus in the audited path; the gap is focus handling while open.
- Original CSS contains a `prefers-reduced-motion` branch; visible focus styling exists for inputs and several widgets. Those strengths do not replace a full-motion/contrast audit.
- The module already tests A4 physical PDF pagination, 58mm/80mm print, long receipts, JPG, repeated canceled dialogs, no accidental POS sale and public Worker fail-closed errors. Hardware printing was **not** checked.
- No runtime or original UI design change is needed to document these findings. The public `RPC method not migrated` feedback is expected before M03/M04; this is **not** a sign that user-visible live ERP functionality is complete.

## 5. Super Board / Impeccable follow-up path

| Priority | Command / owner | Exit evidence |
| --- | --- | --- |
| P1 | `$impeccable harden` — original frontend/template owner, with M03 review if compiled bridge touched | Nonempty HTML language/title, associated labels, exactly maintained form behavior |
| P1 | `$impeccable harden` / `$impeccable adapt` — authorized UI/navigation owner | Modal initial focus, Tab and Shift+Tab contained, Escape & restore, role filters preserved |
| P2 | `$impeccable optimize` — M01 read-only profiling | Actual transfer/compression/startup data before claiming a performance issue or touching source |
| Finish | `$impeccable polish` then fresh `$impeccable audit` | Before/after screenshots (390/1440, and source-required 320/768), Playwright regression, source pin, all exact-head GitHub required checks and reviewer approval |

**Tracker:** [#558](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/558). Fixes must be a **separate reviewed PR**, with Superpowers RED→GREEN and no changes to public financial operations, auth authority, shared D1/posting or original look without the designated owner's decision. The completed M01 #25 signoff remains valid for its **previously tested independent browser QA scope**, but cannot be used as evidence these newly discovered accessibility requirements are already met.

## 6. Review and stop conditions

- **Stopped after one source-backed audit pass** with three confirmed P1 accessibility defects and one unproven performance lead; further polishing without source-owner authority would violate the project freeze.
- **No false visual before/after claim:** no UI fixes implemented and no `ui-refine-loop` automation launched; screenshots only inspected.
- **No fabricated Core Web Vitals, full WCAG score, live authenticated tenant or printer proof.**
- **No private data or remote D1 writes:** synthetic Clerk/invalid dummy login only, temporary local browser environment.
- **Rollback:** revert the documentation-only PR; issue #558 separately retains source-backed repro for approved fixing.
- **Next safe gate:** review this report on GitHub, decide original UI patch ownership, add failing focused accessibility tests on a distinct branch, apply minimal approved fix, run full exact-head CI, then redo the screenshot/refine/finish review on actual changed UI.
