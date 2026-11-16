# M04 — Versioned source staff provenance D1 columns (2026-11-16)

**Source authority:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `Config.gs`, `UserManagement.gs`, `RoleManagement.gs`, `Auth.gs`. **Target authority:** `AGENTS.md`, M04 source contract, `migrations/0003_auth_core.sql`; stacked after PR #281's strict source timestamp preflight.

## 14-sentence design overview
1. The source USERS rows store Created By, Created At and Last Login separately from account identity and current authentication state.
2. The source ROLES rows store Created At independently from original Role ID.
3. The existing migrated authentication tables preserve original User ID and Role ID but have no source-provenance fields.
4. The approved offline rehearsal in PR #279 is not equivalent to full source-faithful migration because those historical fields are not yet stored.
5. This slice adds one additive `0004_auth_source_provenance.sql` migration, with no new tables or staff data.
6. `auth_users.source_created_by` stores original Created By as display text, not a guessed User ID.
7. `auth_users.source_created_at_iso` and `auth_users.source_last_login_iso` retain the protected export's canonical UTC timestamp strings.
8. An empty source Last Login remains an empty string, not the current time or a fabricated login record.
9. `auth_roles.source_created_at_iso` retains each source role creation timestamp.
10. Existing synthetic/authenticated staff and newly created D1-native roles keep NULL provenance until a reviewed import explicitly attaches source fields.
11. Once set, source provenance fields cannot be changed or cleared through normal SQL updates, including after changing a role name or staff status.
12. No existing credential/session/authority epoch contract is modified or relaxed.
13. Remote D1 apply remains fail-closed because the reviewed remote migration count stays two, while all four migrations run only in isolated Workerd/D1 and local Actions tests.
14. A separate next PR must update the offline importer to require validated source provenance, bind these fields and verify exact real D1 readback before any live-data import is authorized.

## RED → GREEN
- Commit contract tests before migration: demand fourth migration, four exact nullable provenance columns, two SQL immutability triggers, and remote staging apply blocked.
- Inspect RED Foundation GitHub Actions failure before implementation.
- Add 0004 migration with four additive columns, SQL immutability triggers, no staff seeds.
- Update local-only migration assertions (3 → 4), verify no Party/accounting behavior changed.
- Add real isolated Workerd D1 regression: apply 0001–0004, set source values once, block modifications or null-out attempts, verify no synthetic staff defaults, exercise original auth core.
- Capture latest exact-head CI, review, merge only after owner approval and all checks pass.
- **No** cloud D1 remote writes, live staff exports, public auth/Worker registry or source modifications.

## File/RPC/table impact
- New SQL: `migrations/0004_auth_source_provenance.sql`, modifies `auth_users` and `auth_roles` only.
- Local/test-only edits: `tests/m04-provenance-schema-gate.test.mjs`, local D1 schema expectations, integration tests and M04 Workerd workflow.
- No user data in GitHub; no source ERP writes. No changes to public Worker, frontend, finance, stock or Party.
- **Dependency:** PR #281 strict source provenance validator; PR #279 local synthetic offline importer is already merged. No production migration permit.
