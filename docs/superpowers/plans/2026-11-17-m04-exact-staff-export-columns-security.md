# Superpowers — M04 protected staff import preflight exact-known-column hardening

**M04 owner:** #23/#252, security coordination #572, parallel board #456.  
**Base:** `main@5a06c28a1a78ec1be9e3867797b0a80b01795901`.  
**Original source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, frozen `Config.gs` USERS/ROLES headers.  
**Scope:** `src/auth/staff-import-audit.js`, `tests/m04-staff-import-audit.test.mjs`, this M04 plan only. No shared migrations, D1 SQL, financial posting, RPC, Worker deployment, source exports or real credentials.

## Implementation overview (12 sentences)

1. The standalone `auditLegacyStaffImport` inspects source USERS and ROLES before a private D1 import.
2. It currently rejects inherited/accessor row fields and validates required source columns.
3. Its `extractOwnData` loop does not reject unknown, hidden or symbol data-property keys.
4. A source row containing an unreviewed additional column can therefore pass this initial audit.
5. The later `captureRows` importer rejects additional columns using its exact frozen-header contract.
6. This disagreement makes the earlier positive preflight result misleading for an operator checking an export.
7. We will preserve the standalone preflight's existing acceptance of its original required base columns.
8. We will also preserve the explicitly reviewed optional historical provenance fields `Created By`, `Created At`, `Last Login` on USERS and `Created At` on ROLES.
9. All other keys, symbol keys and nonenumerable properties must return the existing `ROW_MALFORMED` code without exposing values.
10. The RED unit test will prove that the current preflight incorrectly passes otherwise valid records with unknown, hidden and symbol fields.
11. The GREEN change will use an explicit allowed-key set and own, enumerable data descriptors in the existing extractor, without coercing or executing getters.
12. Full GitHub CI and review are required before integration; this does not approve production staff export, private import or activation.

## TDD and safety
- **RED:** add a Node test to `tests/m04-staff-import-audit.test.mjs`. It must assert unknown user/role fields, hidden source fields and symbols are rejected with `ROW_MALFORMED`; ensure source-known provenance columns continue to pass. Capture exact-head Foundation/Node RED; no disabled tests.
- **GREEN:** minimally change `extractOwnData` to deny unapproved or hidden fields and symbols while accepting only reviewed optional provenance. Never serialize unexpected values, invoke getters or include secrets in issue reports.
- **Acceptance:** full required GitHub Actions, all real Workerd/D1 security suites, accounting, M01 Chromium and M03 sharded CI; verify exact files on main after reviewed merge.
- **Rollback:** revert two M04 files and this plan. No production credentials or source snapshots are used. This is only a validation-contract hardening: public auth remains disabled, staff migration NO-GO, and shared SQL remains M03-owned.
