# Superpowers TDD — M09 single Settings save via reviewed M04 CAS

Date: 2026-11-15. Branch: m09/authorized-shell-settings-save-20261115. Frozen source SHA: 29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.

1. Inspect AGENTS.md, M09 workstream, original Settings.gs updateSettings, merged M09 planSettingsUpdate and M04 single-key authorized update, original UI, D1 schema and existing test fixtures; avoid shared files.
2. RED: commit test-only original GAS VM oracle + local SQLite M02 Settings and M04 auth tests for source-valid Shop Name / Currency Symbol, empty Shop Name, invalid keys, stale CAS, duplicate submit, expired/revoked/role mismatch, no private Settings changes.
3. Add isolated Workerd+D1 test and PR-only no-secret workflow, create draft PR. Record meaningful GitHub RED due to missing production module, repair test fixture first if needed.
4. GREEN: add minimal pure composition of M09 preflight and reviewed M04 SQL-enforced single-key update. Return source success only after SQL confirms. No own SQL, public RPC or multi-key batch.
5. Verify exact-head full Node suite, 84 pinned sources, 36 original frontend includes, dedicated real Workerd+D1, existing D1/Party, Chromium/print and Cloudflare PR preview CI. Resolve actual failures and rerun.
6. Update PR with RED/GREEN evidence and exact six-file impact; leave draft for owner. Rollback: revert six new files; no data migration. Future full Settings mutation and multi-tenant auth are gated.
