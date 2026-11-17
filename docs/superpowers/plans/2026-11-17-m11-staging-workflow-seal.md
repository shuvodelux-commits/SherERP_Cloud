# M11-13 — Seal the approved manual staging workflow against hidden command changes

**Workstream:** M11 / issue #306; coordination issue #456. **Base main:** `ca04f103f798955920e788d52a856207c2932c3b`. **Source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Parent:** M11-12 PR #465 merged via `4c1b5b6dba1baa7a7af07e70954556658e9ac588`.

## Superpowers 12-sentence plan

1. M11-12 added a read-only, source-based audit to prevent a second Worker deployment owner or ordinary PR CI from receiving remote D1 credentials.
2. Its existing manually gated staging workflow exception is validated by selected workflow text and CLI-command patterns.
3. A malicious edit can keep those selected guard tokens inside comments or add a second command while weakening the executable staging approval conditions.
4. M11-13 therefore seals the **entire** single approved `.github/workflows/remote-d1-staging.yml` file using its current reviewed Git blob identity, not merely a collection of substrings.
5. A single pinned baseline identity makes any edit to remote-staging commands, guard conditions, triggers, environments, shell steps or comments fail closed until reviewed and resealed in a new PR.
6. The source-audit remains pure, local and dependency-free using the built-in Node crypto module to compute the same Git blob hash as the reviewed repository file.
7. Existing semantic restrictions on the manual staging exception remain as defense in depth and are not relaxed.
8. The pinned identity must match current `main`, and no separate production or public-preview exception may be introduced.
9. New tests first prove that the authentic current workflow passes, while injected secondary shell commands, comment-only guard spoofing and altered migration counts fail with the dedicated unreviewed-change code.
10. The test-only commit must demonstrate an expected RED in GitHub Actions before the minimal implementation is committed, then exact-head full Node, local real Workerd/D1, browser and deployment-safety checks must pass.
11. The fix changes only the M11-owned scanner, its tests and this plan, and never edits workflow YAML, Wrangler bindings, SQL migrations, financial posting code, source GAS/Sheets or live Cloudflare resources.
12. A passing static check proves only that repository workflow text matches the reviewed baseline and **never** approves staging/private-data import, production deployment or M10/M11 business cutover.

## Ownership and dependency handshake

- **Exclusive M11 paths:** `scripts/m11-ci-deployment-ownership.mjs`, `tests/m11-ci-deployment-ownership.test.mjs`, this new plan. Read-only dependency: `.github/workflows/remote-d1-staging.yml`; M11 does not modify it.
- **Current approved staging Git blob:** `cd8ef338cf2e532f43c12fffc01654452917fe60`.
- **No shared owner conflict:** no `src/db`, `src/rpc`, `src/index.js`, `migrations`, `wrangler*.jsonc`, shared posting/reversal kernel, Party accounts or Cash Session authorization changes.
- **Affected RPC/SQL/source identifiers:** none. Reads local workflow text only. No remote read/write.
- **Test gate:** failing exact-code negative cases first; GREEN after source-hash check; then all required CI and owner review.
- **Merge sequence:** PR #465 merged to main; this branch begins on fresh main, targets main, requires full exact-head CI with no conflicts; the single manual staging workflow remains untouched.
- **Rollback:** revert scanner/test/plan only. No database or production state touched.
- **Future legitimate edits:** the manual staging workflow must be reviewed by M11/owner and the approved baseline pin updated in the same explicitly coordinated PR after full CI.
