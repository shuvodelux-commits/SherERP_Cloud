# Superpowers plan — M03 safeTimeOnly_ source parity

**Workstream:** M03 utility compatibility (independent of the pending M03 UI PR #159 and exclusive M03-core DB owner).
**Base:** fresh `main` as of 2026-11-15; branch `feat/m03-source-time-normalizer-20261115`.
**Source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Spec:** `docs/superpowers/specs/2026-11-15-m03-source-time-normalizer-design.md`.

1. Confirm latest `AGENTS.md`, `docs/WORKSTREAMS.md`, `src/db/settings-read.js` already ports `isSettingEnabled_` (avoid duplication), and frozen `Utils.gs::safeTimeOnly_`; read current PR overlap.
2. **RED:** Add `tests/m03-source-time-only.test.mjs`. Run original frozen `safeTimeOnly_` in Node VM with a source-compatible GAS Date formatter only inside the test; include hand-verified literal timestamp/timezone expected values and negative missing-zone cases for the new API. Commit tests **before** code; record GitHub Foundation missing-module failure.
3. **GREEN:** Add exactly one dependency-free `src/modules/source-time-only.js` pure function. Only Date objects use explicit Intl timezone; string/number input mirrors original string rules. No SQL/Worker/frontend changes.
4. Review all branch CI at GREEN head: Node, source SHA/source verification, 36 original UI include assembly, M01 Chromium, M03+M04 real local workerd/D1, M02 local staging/Party, Cloudflare PR safety. Investigate/redrive any failing tests; don't extrapolate earlier CI.
5. Open scoped draft PR recording source SHA, exact files/RPC/table impact, RED/GREEN commit/run evidence, outstanding gates, rollback; check latest `main` for file overlap. **Do not merge automatically or enable public RPC**.

No production D1 data, tenant security policy, date storage format or original UI is changed. Future callers must supply a trusted business timezone and get separately reviewed integration tests.
