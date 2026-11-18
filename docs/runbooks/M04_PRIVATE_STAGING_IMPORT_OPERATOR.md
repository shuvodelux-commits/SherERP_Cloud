# M04 — Private staging Administrator-first staff import operator

**Status: IMPLEMENTED TRANSPORT / NOT AUTHORIZED OR READY TO EXECUTE AGAINST REMOTE D1.** This runbook is the follow-up to merged M03 auth migrations 0003/0004 and M04 #633's exact-source local Workerd/D1 rehearsal. A green synthetic test does **not** authorize exposing real staff credentials or modifying staging. M03 owns shared binding/integration; M04 owns auth validation; M11 owns recovery review.

## Exact scope and source evidence

- GitHub: `shuvodelux-commits/SherERP_Cloud`; frozen Mohim source `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
- Only target: Cloudflare account associated with `agnishuvo@gmail.com`, operational `shererp-staging-db`, UUID `aa04618e-1639-4cb9-bdf5-7b967d8b968b`.
- Do **not** connect the distinct private historical archive `shererp-legacy-history-staging-20261118` UUID `3328e5c8-7695-4d6c-8bcf-9725437ebdd5`.
- Remote ledger must be **exactly 0001, 0002, 0003, 0004** with the original core/Party table and trigger invariants; the authentication tables must all be empty immediately before import. **Do not run the root 14-file migration queue.**
- Genuine protected archive tests have proved 3 source Users, 2 Roles, 2 importable staff, 1 Owner deferred from enrollment. The historical Owner remains **Active** with original ID, mobile, verifier and source values preserved. No fabricated phone, status lock, or duplicate identity.
- The protected workbook's Excel 1900 timestamp projection uses owner-confirmed Asia/Dhaka (+06:00), but the exact original Google Sheet timezone has not independently been matched to the archived workbook revision. **Before any remote staff write, require reviewed historical-time provenance attestation**; corroborating unrelated Sheets metadata is not enough.
- Source Sessions and bearer tokens are **never** imported. Existing importer creates `LegacyPending` credentials; future first verified login upgrades to PBKDF2.

## Implemented reviewed-code candidate (no production route)

`src/auth/m04-private-import-operator.js` is **not** imported by `src/index.js` or `src/rpc/registry.js`. It has only a loopback-only POST path `/_private/m04/staff-import-once`. A request requires an ephemeral secret, no Origin/Cookie, exact JSON shape, strict size limits, and a single authorized private D1 binding. The Worker never logs raw requests, user values, salts, hashes, or SQL errors, and returns only counts and false release flags. It reuses `prepareAdminFirstLegacyStaffEnrollment` for the two-capture exception and invokes the original `importLegacyStaffSnapshotWithD1` for the SQL-atomic clean-store claim and exact reconciliation, rather than calling the local-only rehearsal wrapper. A second call against the same D1 is refused. The synthetic test worker cannot bind the real staging D1.

`scripts/prepare-m04-private-staging-operator.mjs` **only prepares files**. On a trusted operator machine, it generates a fresh mode-0700 directory outside GitHub, `wrangler.private.jsonc` mode 0600 and `.dev.vars` mode 0600 with a fresh 256-bit token. The config has exactly one remote:true D1 binding to the named operational staging database; no Worker route, assets, archive binding or deploy step. The token is never returned or printed.

## Remaining human-controlled operator gate — NOT YET EXECUTABLE

1. Independently review this PR's security and all CI tests with M03, M04 and M11. Do not merge or execute if any check fails, if a conflicting PR claims `src/auth/**`, or if current main has drifted.
2. Establish custody of two independently captured complete, protected historical Users/Roles snapshots, workbook/revision/source identity, and exact source timestamp interpretation. Run the merged full archive integrity proof and two-pass M04 roster consistency check. Avoid publishing rows in PRs, Cloudflare logs, or ChatGPT messages.
3. Confirm the Cloudflare account and exact operational D1 name/UUID by fresh read-only Wrangler queries. Verify migration ledger 0001–0004, original Party guards, **zero auth rows**, correct source record counts, and no concurrent operator/import.
4. Create a **fresh** private D1 SQL export and restore it to disposable local SQLite with integrity and row-preservation checks. Capture a **fresh private Time Travel bookmark**. M11 must approve rollback custody and the effect of any later writes. Never automatically restore a shared database on error.
5. Verify an ephemeral D1 remote binding is supported by the installed Wrangler version in **local-only execution** with no remote Worker deployment. A representative command, **for review only**, is `wrangler dev --ip 127.0.0.1 --port 8787 --config /protected/dir/wrangler.private.jsonc`. The generated binding uses `remote:true` to reach staging D1 while the Worker runtime stays local. **Do not add `--local`**: Cloudflare documents that `--local` disables remote bindings; **never add `--remote`** either, because it uploads Worker code to a remote preview; **do not run this command against the real DB until independently authorized**.
6. A separate trusted local client (NOT INCLUDED in this PR) must perform an exact, no-log, authenticated one-shot POST using two independent complete snapshots, with the ephemeral token read from the restricted file. It must not use a shell command-line password, put secrets into environment-wide logs, upload exports, create a public HTTP endpoint, or retry automatically after an uncertain response.
7. After a successful import, requery D1 privately and verify **two** source-faithful Users, **two** Roles, **two** isolated pending legacy verifiers, **zero** Sessions and Throttle entries, unchanged historical Owner source record, and full exact readback. Capture a new private recovery checkpoint. Never publish User IDs, phone values, password hashes or salts.
8. If a request times out, reports an error, or the D1 state differs, **stop**. Read back before any retry; successful committed writes must not be replayed. Recover only after M11 operator review.
9. Actual login, first-user credential upgrade, session validation, authorized Owner phone claim and production access are separate approvals. The public Worker/RPC remains intentionally fail-closed; no POS, ledger or financial writes are enabled here.

## Test-first evidence and limits

RED: `tests/integration/m04-private-import-operator-workerd.spec.mjs` failed with a missing entry point; the new configuration-generator test failed with missing builder. GREEN: 3/3 local Workerd/D1 transport tests + 2/2 Node config tests pass. The existing real-source (private) M04 local rehearsal has separately verified 2-of-3 partial enrollment and exact readback. These are **local** tests, not remote staff-import evidence. Full exact-head GitHub CI, independent security review and operator/cutover approval are still outstanding.

**This change must not be used to infer that real Administrator login is active.**
