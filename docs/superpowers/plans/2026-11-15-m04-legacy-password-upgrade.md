# Implementation plan — M04 first-login legacy password upgrade

1. Work from new isolated worktree on origin/main, verify source hash implementation, D1 schema and existing 20 local Workerd tests.
2. Add real local Workerd/D1 red tests for pending legacy account: old source hash, wrong password, lockout, concurrent success, active role, and source-shaped login/session restore. Confirm RED before new schema or implementation.
3. Extend test-only auth SQL with credential_state, auth_legacy_credentials table, and SQL trigger that destroys the old hash/salt in the same commit as pending->modern update. Keep modern columns PBKDF2-only. Update existing test's table inventory.
4. Implement targeted loginWithD1 path using existing verifyLegacyPassword, createOfflinePasswordCredential, strict SQL CAS and refetch, while preserving original PBKDF2 login behavior and atomic D1 throttle/session boundary. Under no circumstances issue a token from a legacy verifier alone.
5. Run focused real local Workerd+D1 tests, source/auth schema Node tests, complete npm test, source manifest, frontend build and M03 source audits. Inspect diff for any production DB/migration/Cloudflare changes or secrets.
6. Commit and open draft M04 PR. Link to security and schema-owner review; do not claim live login operational.
