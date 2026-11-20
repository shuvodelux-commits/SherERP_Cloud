# M03 — Owner Shop D1 write-lease integration (local-only)

**Scope:** M03 shared Shop D1 auth kernel, issue #22 and coordination #456 comment 7036069149; PR #785. Based on main `0319b58e`. Original Mohim_ERP source remains untouched.

## Security contract
Merged #783 validates Owner bearer age in Control D1 and limits the browser cookie to 12 hours, but the Shop D1 write grant previously had no independent SQL expiry. This additive seventh Owner-ready migration provides `expires_at_ms` and rejects increasing the same generation deadline. Legacy grants keep NULL expiry and fail closed until a new valid Control session generation is published. The Control grant claim returns `issued_at_ms + 12 hours` from its own checked session; the Shop D1 update independently bounds the deadline to its own current SQL clock. Operational Product writes and receipts now require `expires_at_ms > unixepoch('subsec')` in their SQL mutation, not only in JS preflight.

## RED and GREEN evidence
RED test-only commit `ae5e6e75668fa2e8d14b5e59134987472a31d1ab` failed the real local Workerd/D1 gate with `no such column: expires_at_ms` in [Actions #44712481052](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44712481052). GREEN must verify seven checksum-pinned Shop migration receipts, two-Shop owner login/Product write/replay, legacy grant denial, time expiry without Control logout, generation fencing, migration interruption and clean SQL-time Product authority. Do not claim hosted confirmation from local tests.

## Release and rollback
New profile requires migration 0004 applied AFTER 0003. Reissue Owner sessions/grants after an approved migration; do not retroactively activate legacy grants. **A code rollback that ignores expiry after migration is unsafe**: release must gate compatible rollback or revoke outstanding grants. No public RPC, financial writer, remote D1, Cloudflare deployment, OAuth setup, source import or production cutover is authorized. M02/M03/M04 integration, authenticated POS/return reconciliation, M10 restore and M11 GO remain separate checks. Independent security/QA review and explicit owner merge approval are required.
