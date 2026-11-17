# M01 original shell — Super Board `ui-refine-loop` Playwright review

**Target:** original application route `/` (sign-in and synthetic authenticated shell/mobile “More”).  
**Date:** 2026-11-17.  
**Scope:** M01-owned original UI QA and screenshots. No frontend redesign, no financial write or shared Worker/D1/RPC change.  
**Before source:** `SherERP_Cloud/main@5a06c28`, prior to the accessibility implementation.  
**After source:** [PR #569](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/569) head `20d87bf2ecb85416694c7eee197cd92d4d124743`, now merged into `main` (merge SHA `03b4f0e5d9af36b4c24c0d8a8eb4f1da89b01fb7`).  
**Original frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; unchanged.  
**Evidence JSON:** [contract-evidence.json](contract-evidence.json).  
**Direction:** [taste.md](taste.md) — preserve original visuals, refine accessibility only.

## Execution and limitations

The upstream [Super Board `ui-refine-loop` skill](https://github.com/EricTechPro/super-board/blob/main/skills/ui-refine-loop/SKILL.md) was read and its **actual `refine-setup.sh detect`** and **`scripts/shoot.mjs`** were executed against isolated GitHub clones.

The setup found `devCommand: null`, `authScript: null`, `critic: "rubric"` and `impeccable: null`, with this exact warning:

> Impeccable NOT FOUND: the loop will use the built-in rubric (references/rubric.md). Scores are not Impeccable scores. Install the impeccable skill under .claude/skills or .agents/skills, or set refine.impeccable.

There was no Workflow/Agent orchestration tool exposed to this execution environment, so **no claim is made that five autonomous fresh-checker/fixer rounds or a separate finish-reviewer agent ran**. This is a **degraded, bounded manual execution** using Super Board's screenshot utility, fallback rubric, real Playwright browser checks and a GitHub draft PR. The original source is frozen and the target-specific a11y fixes had already been built via Superpowers RED→GREEN on PR #569.

The screenshot utility was locally adapted (not committed to the repo) to use system Chromium and retain the **synthetic Clerk's current page after login**, because the intentionally inert public Worker cannot restore that test-only session on a full page reload. This adaptation was necessary to avoid falsely capturing a logged-out view as an authenticated screenshot. Screenshots contain no real account, customer, financial or tenant information.

## Round checks and stop reason

| Check | Fallback design /20 | Fallback audit /20 | Total /40 | Result |
| --- | ---: | ---: | ---: | --- |
| **C1 — Before** | 15 | 12 | **27** | Original pixels pass visual review, but missing page metadata, form labels and mobile dialog focus are verified P1 defects |
| **C2 — After PR #569** | 15 | 14 | **29** | All three targeted accessibility defects fixed; screenshot pixels unchanged |
| **C3 — Final mechanical review** | 15 | 14 | **29** | Separate Playwright keyboard/DOM and PNG pixel comparison confirm no measured P0/P1 remains in the scoped shell |

Scores are **manual, provisional fallback-rubric judgments**, not official Impeccable output, a WCAG 2.2 AA certification or a claim covering every ERP screen. Performance and full dark-theme support were not benchmarked. The same pixels produce the same design score; the audit score improves because the accessible behavior was corrected.

**Stop condition:** two post-fix checks (functional/keyboard and visual/pixel) found no remaining P0/P1 in the **scoped** shell. No new cosmetic source edits were justified under the frozen-UI rules, so this evidence PR is documentation + M01 browser screenshots only.

## Playwright before/after: measured results

| Acceptance criterion | Before | After |
| --- | --- | --- |
| Document `lang` | Empty | `en` |
| Browser `title` | Empty | `Hardware Store ERP` |
| Mobile Number label `HTMLInputElement.labels` | Empty | `Mobile Number` |
| Password label `HTMLInputElement.labels` | Empty | `Password` |
| More sheet keyboard focus on opening | Outside dialog | Inside dialog |
| Background shell while More is modal | Focusable | Inert |
| Eight forward Tab presses | Escape to shell | All contained |
| Eight reverse Tab presses | Escape to shell | All contained |
| Escape closes More | Yes | Yes |
| Escape restores focus to More trigger | No in test | Yes |
| Page-level horizontal overflow at 390px | 0px | 0px |
| JavaScript page errors in test | None | None |
| Same-size before vs after PNG pixel comparisons | — | **8/8 pairs: 0 changed pixels** |

The eight pairs were produced by Super Board's `shoot.mjs` at **1440×900** desktop and **390×844** mobile, with both **light** and **dark browser color-scheme emulation**, for public login and the test-only authenticated shell. The screenshot comparison verified visual equivalence, not that the ERP actually implements a dark theme.

## Screenshot handoff on GitHub

The new M01 Playwright evidence test `qa/m01-a11y.spec.mjs` captures eight fresh PNGs to `test-results/m01-browser/`, already uploaded by the existing [M01 preserved-UI Chromium CI workflow](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/workflows/m01-browser-qa.yml) under the artifact name `m01-browser-evidence`. No modification to shared CI configuration or `package.json` is needed.

| Screenshot | Before | After |
| --- | --- | --- |
| 390px login, light/dark | [Earlier M01 browser artifact (PR #559)](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44088192230) | [Accessibility-fix browser artifact (PR #569)](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44090970815), plus this PR's `ui-refine-login-mobile-390-{light,dark}.png` |
| 1440px login, light/dark | [Earlier M01 browser artifact](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44088192230) | This PR's `ui-refine-login-desktop-1440-{light,dark}.png` |
| 390px More modal, light/dark | Before shots captured in isolated local temp worktree | This PR's `ui-refine-shell-mobile-390-{light,dark}.png` |
| 1440px synthetic Dashboard, light/dark | Before shots captured in isolated local temp worktree | This PR's `ui-refine-shell-desktop-1440-{light,dark}.png` |

**Important artifact limitation:** The initial 16 local before/after PNGs and four light-theme comparison sheets were verified locally, but the local desktop connector stalled before they could be copied into a GitHub binary commit. They must **not** be claimed as committed screenshots. The GitHub Actions Playwright test added by this branch is the persistent, reviewable screenshot evidence; artifacts have limited retention, and can be regenerated by rerunning the CI workflow. The screenshots linked above from older workflows are available subject to GitHub's retention.

### Finish review / acceptance grades

| Problem | Severity before | Grade | Evidence |
| --- | --- | --- | --- |
| Missing HTML language and title | P1 | **Fixed** | Playwright DOM before/after and merged PR #569 |
| Unassociated visible login labels | P1 | **Fixed** | Browser-accessible label association and merged PR #569 |
| Mobile More modal focus escapes | P1 | **Fixed** | Synthetic Chromium entry/Tab/Shift+Tab/Escape test and background `inert` |
| Regressed appearance at sampled breakpoints | P1 regression risk | **No regression observed** | Eight PNG pixel comparisons identical and no document overflow |
| Entire ERP WCAG and real finance data | Outside target | **Not evaluated** | Future integrated M03–M11 testing remains separate |

**Risk: 🟡** Accessibility gains are real within the specified browser states, but this is not a live D1-authenticated ERP E2E or a production-release authorization. There is no independent fresh sub-agent finish reviewer and no dark-mode design certification; the honest fallback scores above are for this one target. The PR changes **one M01-owned browser QA file plus these unique evidence documents**; M03 shared Worker/posting source is untouched.

**Next review gate:** Verify GitHub's exact-head checks and `m01-browser-evidence` artifact for this PR. Keep this **draft PR** available for human review; the upstream `ui-refine-loop` prohibits automatic merge. The completed accessibility fix lives in merged PR #569, not in this screenshot PR.
