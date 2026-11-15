# Superpowers: M09 Settings update pure preflight

Date: 2026-11-15. Branch `m09/settings-update-preflight-20261115`. Pinned GAS SHA `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

1. Inspect AGENTS.md, M09 owner boundaries, frozen Settings.gs updateSettings and Utils.gs numeric/sanitization helpers. Check current M03/M04 D1 update code and other open PRs to avoid shared files.
2. Write original GAS VM oracle tests first in `tests/m09-settings-update-preflight.test.mjs`. Stub Settings lock, settings.edit permission, getAllRows BANK_ACCOUNTS, intercepted setSetting_ with source order, mock ok_/fail_, compare returned response and writes. Include valid payloads, failures before any write, boolean and numeric semantics, JSON arrays, default bank even inactive, untrusted input and no side effects.
3. Commit test plus plan/spec, open draft PR, observe expected missing-module RED in exact GitHub Actions Node source/Worker job.
4. Add minimal pure `src/modules/settings-update-preflight.js` function `planSettingsUpdate`, no D1, RPC, time, network or dependencies. Follow source validation ordering and the existing source allowlists. Do not commit actual writes.
5. Verify exact-head Node regression and source manifest (84 original files), original HTML (36 includes), isolation Workerd D1, Cloudflare preview and browser/print checks. Fix any failures and repeat. Diff exactly four new files.
6. Update PR with RED and GREEN evidence, file/RPC/table impacts, intentional fail-closed input validation differences, remaining M04 authorized Settings writing gates and rollback. Leave for review, never auto-merge.

Rollback: revert four additions only.
