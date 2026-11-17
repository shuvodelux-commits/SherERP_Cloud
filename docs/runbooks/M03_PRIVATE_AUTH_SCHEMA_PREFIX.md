# M03 — Private staging auth-schema prefix handoff (NO-WRITE)

**Status:** Documentary, owner-review required. Does not authorize remote migrations, staff import, public login, Worker deployment, or production cutover.

**Verified baseline (2026-11-18):** After merged PR #633, read-only Wrangler D1 queries against the selected account's operational **shererp-staging-db** (UUID aa04618e-1639-4cb9-bdf5-7b967d8b968b) returned exactly two applied migrations: 0001_core_catalog.sql and 0002_party_identity.sql. Seven original application tables and four Party protection triggers remain. There are zero authentication tables. The verified historical archive (UUID 3328e5c8-7695-4d6c-8bcf-9725437ebdd5) remains a separate D1.

## Evidence in this PR

- The internal read-only checker **scripts/check-m03-auth-staging-prefix.mjs** validates exact original staging/private archive D1 identities, DB-free public preview, SELECT-only Wrangler metadata, precisely ordered migration ledger, seven table names, and four Party triggers. All database-write and activation flags remain false.
- **tests/m03-auth-staging-prefix.test.mjs** replays the original 0001/0002 SQL in a local SQLite database with synthetic populated Settings/catalog/Party rows and applies only the existing 0003/0004 SQL in a local transaction. It verifies every pre-existing row, Party protection, five empty auth tables, source provenance columns, and SQLite integrity.
- On the owner's computer, the checker was run with genuine remote D1 metadata-only SELECT results. Exact prefix match passed; no remote rows were changed.

## Proposed protected next gate — separate approval required

1. M03/M04 independently review the exact auth core and source-provenance migration contents, the source identity/RBAC claims, and existing Party schema, and pin the intended release SHA.
2. M11 verifies restricted GitHub environment reviewers/secrets, captures an encrypted/private export and Time Travel recovery bookmark before any remote schema write, and independently proves recovery. Never upload sensitive data into GitHub Actions artifacts.
3. Approve a **separate explicit auth-only staging migration runner** whose migration source contains only ordered 0001, 0002, 0003, 0004 and whose only destination is the exact operational staging D1. It must detect already-applied 0001/0002 and add only 0003/0004 through the D1 migration ledger.
4. **Do not run the existing protected workflow's apply operation.** It intentionally requires exactly two migration files and an empty database, and the real staging database already contains seven application tables. Do not remove or bypass these safeguards.
5. **Do not run the root 14-migration queue remotely**: it includes ten further unapproved migrations after the auth-only pair. A safe new runner must be specifically reviewed and human-approved before its first remote write.
6. After approval, verify exactly four migrations in the remote ledger, all original seven application tables and four Party triggers unchanged, exactly five newly installed auth tables, required source-provenance columns/triggers present, and zero newly inserted staff/credential/session rows from schema migration.
7. Then M04 can separately stage genuine Administrator-first **partial** staff enrollment using two independently verified private snapshots. Preserve the original historical Owner user's Active status, User ID and unsupported source mobile unchanged; defer its new-D1 enrollment until the owner corrects the number through a separately authorized, audited flow.
8. The current M04 login documentary gate expects complete 3-user source parity, whereas the approved staged exception would import only two eligible users. Review this gate explicitly rather than claiming all original users imported or inventing counts.
9. Public auth/RPC, production traffic and financial posting remain blocked pending their own source, security, recovery and human approval gates.

**Rollback:** This PR changes no database and requires no rollback. A later approved schema promotion needs a separately verified backup/restore operator and recovery point; reverting a GitHub commit will not roll back remote D1 schema history.
