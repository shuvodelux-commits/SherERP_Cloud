# M04 Run 4 — Source POS permission at the current SQL authority boundary

**Repository:** shuvodelux-commits/SherERP_Cloud
**M04 issue:** #23/#252; **M03 integrator:** #22; **finance:** M08 #66; **board:** #456.
**Source:** pinned Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2; frozen legacy/source/CashSession.gs and RoleManagement.gs.
**Base:** main@41f6283da9cd197479da354724f49c14f4128989 after merged #738.
**Parallel at claim:** M03 #742, M05 #739, M08 #741, M10 #740, M01 #744.
**M04-only paths:** this plan, tests/integration/m04-auth-workerd.spec.mjs (append-only), NEW tests/fixtures/m04-source-pos-action-probe.mjs.
**NO shared files:** src/db/**, migrations/**, src/rpc/**, src/index.js, Worker config/bindings, Control Center, original UI, financial posting, remote D1 or CI workflow definitions.

## Implementation overview (12 sentences)
1. M04 #738 verified that frozen Start Day and Close Day each require the staff source permission pos.add.
2. The original Cash Session Summary requires pos.view and does not imply permission to open or close a session.
3. M04 #737 proved SQL-time session and credential checks, but used a synthetic can_record role flag rather than source-shaped role JSON.
4. This independent slice uses the actual existing M04 auth_users, auth_roles and auth_sessions tables in disposable real Workerd/D1.
5. A new test-only operation records synthetic Start/Close receipts under the same SQL INSERT that verifies the current staff authority.
6. A separate Summary-only SQL SELECT checks pos.view and writes zero synthetic receipts.
7. Administrator bypasses source role grants only with a currently active, Modern, version-matched and unexpired D1 session.
8. Nonadmin permission metadata must be valid, strictly typed, canonical JSON consistent with allowed_modules, and current at the SQL statement boundary.
9. A preflight role JSON parser is not itself authorization: the SQL write must recheck the exact role text, module list and authority epoch to prevent stale approval.
10. Duplicate operation IDs must return the same current-actor receipt only for the original action, while changed-intent and other-actor replay deny generically.
11. Role disable/reenable, credential rotation, logout, time boundaries and late trigger failure must never create a duplicate or partial receipt.
12. Test-first RED, minimal GREEN, real local Workerd+D1 evidence, exact-head full CI and independent M03/M04/M11 review precede owner-approved merge.

## Acceptance and exclusions
- Use strict fixed method mapping from approved source: startCashSession=pos.add, closeCashSession=pos.add, getCashSessionSummary=pos.view.
- The test-only record and journal are **not** real cash-session start/close, historical cash book, sale, supplier ledger or business financial operations.
- A source role may have pos.add with pos.view false; Allowed Modules tracks view only. Never incorrectly require pos.view for add.
- Reject string "true", JSON duplicate keys, contradictory Allowed Modules and unsupported metadata. Prevent a previously issued token from regaining access after role toggles.
- The source cash lifecycle is different from this synthetic receipt and is not modeled as a production operation. M03 alone designs the real atomic lifecycle, Cash Session ON/OFF and posting SQL.
- The frozen source original and source validation tests stay unmodified. No live staff import, Google login/OAuth, production/RPC activation or remote D1.
- Existing M04 authentication CI executes tests/integration/m04-auth-workerd.spec.mjs, so no shared CI edit is required.
- Do not advertise readiness: M02 supplier/Party source identity, M08 exact-decimal policy, M03 posting/reversal and M10/M11 launch remain blocked.
- The **RED** commit must be observed in GitHub Actions before the GREEN fixture is added. Merge only with independent Super QA/Super Review and owner approval.
