# M04 Offline Staff/Role Import Preflight — Design (2026-11-15)

**State:** review-only standalone helper. No staff import, live login, session migration, D1 schema, remote DB writes or public RPC route.

## Source and purpose
Pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`: `legacy/source/Config.gs` defines the original USERS and ROLES columns; `Auth.gs` uses `SHA256(UTF8(password+UUID salt))`, exact built-in Administrator, and requires active users/roles; `UserManagement.gs` preserves the last Active Administrator and prevents duplicate staff identities; `RoleManagement.gs` reserves Administrator and prevents duplicate role names. This preflight identifies broken **staff** and **role** snapshots before an owner-authorized protected import into D1.

**Not covered:** Phone-equivalence collision detection (isolated PR #39); permission-map semantics (PR #30); real password migration/KDF, session storage/revocation (PRs #34–#36), database CAS/transactions and issuance. Passing this audit is **not** M04 readiness. Existing legacy SESSIONS bearer tokens are excluded and must not be imported.

## Approaches considered
1. **Chosen:** Pure `auditLegacyStaffImport(users,roles)`, based only on the two original sheet row arrays, returning anonymized issue codes and counts. It cannot mutate data, log credentials, write SQL or authorize anyone; suitable for source-only offline fixtures and early integration review.
2. Create and populate production D1 auth tables now. Rejected: the M03 single-owner schema/kernel gate, protected import procedure and real session tests are outstanding.
3. Copy raw legacy USERS/ROLES/SESSIONS into test fixtures or logs. Rejected: passwords/salts and bearer tokens are sensitive; use fabricated fixture values only.

## Contract
Export `auditLegacyStaffImport(users, roles) -> {preflightPass:boolean, counts:{users:number, roles:number, activeAdministrators:number}, issues: Array<{scope:'snapshot'|'user'|'role', row:number|null, code:string}>}`.

- Both snapshots must be successfully retrieved, complete arrays; null, undefined, malformed/sparse and accessor arrays fail closed. A remote storage error must never be converted into `[]`.
- Accept each row only as a plain own-data object (or null-prototype map), never inherit source columns or invoke getters. Proxies and malformed records produce fixed issue codes, not attacker-controlled error text.
- Require nonempty string source `User ID`, `Role ID`, staff `Full Name` and `Role`, plus source-backed `Active/Inactive` statuses. `Mobile Number` accepts nonempty string or a safe, positive integer (legacy Sheets numeric coercion); this audit does not normalize or compare phones, which remains PR #39's scope. IDs must be unique **as exact strings** (no trimming or conversion). Role names unique case-insensitively, including original sanitization trim; `Administrator` must never be a custom ROLES entry (built in).
- Each user has syntactically valid legacy lowercase 64-character SHA-256 `Password Hash` and canonical UUID `Password Salt` (not the password), including inactive users; mismatches require review rather than silently dropping an account or password.
- Each custom role must have a syntactically JSON-object `Permissions` string and string `Allowed Modules`; this is only syntax, **not permission authorization**. Active staff may not reference nonexistent or inactive custom roles. Inactive staff may reference an inactive, existing custom role (preserving source behavior). Missing references on any user are reported.
- Require at least one Active user with exactly `Role='Administrator'` in the snapshot. The last-admin predicate in real D1 must still be atomic; this audit cannot enforce concurrent writes.
- **Never return any identifiers, names, mobiles, password hash/salt, raw row data, role permissions, or arbitrary thrown message**. Only fixed issue codes, zero-based row indices and aggregate counts. Results must be deterministic, no output from console, no mutation.
- No auto-links by phone, name or address to Party accounts. ADR-007 remains authoritative.

## Ownership / files
New `src/auth/staff-import-audit.js`, `tests/m04-staff-import-audit.test.mjs`, this spec, `docs/superpowers/plans/2026-11-15-m04-staff-import-audit.md`. Do not edit shared `src/db`, migrations, `src/rpc`, `src/index.js`, current auth helper files, frontend, Cloudflare or immutable sources.

## Acceptance / release gate
TDD RED→GREEN, exact source column parity assertions, fabricated test fixtures for duplicate IDs/roles, no admin, invalid credentials, inactive role, inherited/getter/proxy rows, JSON permissions syntax, sensitive-redaction and HTTP 501 public login. Full `npm test`, `npm run verify:source`, `npm run build:frontend`, `node --check`, `git diff --check`. Open draft PR for independent review and CI. No real data import and no claim of full M04 readiness.
