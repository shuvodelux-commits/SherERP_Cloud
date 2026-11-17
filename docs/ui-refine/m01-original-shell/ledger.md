# M01 original shell refine ledger

Target: original `/` shell; baseline `main@5a06c28`, final behavior `PR #569@20d87bf`, frozen original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

| Round | Checker / evidence | Design /20 | Audit /20 | Result /40 | Decision |
| --- | --- | ---: | ---: | ---: | --- |
| **C1, baseline** | Super Board `shoot.mjs`: 1440/390, light/dark, login and synthetic More; Playwright DOM and Tab cycle | 15 | 12 | 27 | P1 missing `lang`/`title`, login labels and dialog focus |
| **Fix already landed** | Superpowers RED→GREEN [PR #569](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/569), original-source-preserving compiled patch | — | — | — | 52/52 head CI passing, 83/83 M01 browser tests previously verified |
| **C2, behavioral review** | Fresh before/after Playwright contract JSON: labels, 8 Tab + 8 Shift+Tab, modal inert background, Escape restoration | 15 | 14 | 29 | No reproducible P0/P1 remains in the scoped shell |
| **C3, visual review** | Eight PNG image pairs (1440/390 light/dark across two states): **zero changed pixels per pair** | 15 | 14 | 29 | No visual regression; stop after two post-fix checks |

**Stop reason:** no P0/P1 found in the two post-fix scoped checks; further cosmetic changes would conflict with the frozen original UI.

**Degraded mode:** Impeccable was not detected; the supplied fallback rubric was applied manually. No Workflow/Agent sub-agent tool was exposed, so there were no fresh autonomous checkers/fixers or a separately executed finish-reviewer agent. The screenshot capture utility and Playwright were actually executed; there were **no new visual production edits** in this refinement branch.

**Artifacts:** before/after local captures compared as reported in [README.md](README.md); added M01 Chromium screenshot test uploads persistent review evidence to the existing GitHub Actions `m01-browser-evidence` artifact. All 16 before/after PNG screenshots plus 8 comparison sheets are now committed under `shots/`. The GitHub PR is draft and must not be auto-merged.
