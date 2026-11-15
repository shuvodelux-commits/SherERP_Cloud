# M04 — Deny session-row deletion pending safe retention design

Date: 2026-11-15  
Workstream: M04-design, isolated local Workerd/D1 auth fixture  
Frozen source: `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (`Auth.gs`)  
Dependency: merged M04 #221 (session REPLACE guard)

## Problem and scope
The local-only `auth_sessions` table has guards against changing a session's token/authority/absolute-expiry/revocation and against `INSERT OR REPLACE` of an *existing* token. `DELETE FROM auth_sessions` still removes that immutable history; a subsequent `INSERT` of the original fingerprint and cleared revocation can revive a logged-out bearer. Because source cloud auth has not been approved/deployed, treat this as **fixture-only fail-closed migration research**, not a production retention plan or privileged-DB security boundary.

## Superpowers TDD (RED → GREEN)
1. First commit a real local Workerd/D1 test for an issued, revoked session: assert the original SQL DELETE is rejected and original revoked row remains; another test covers an active session. The RED test must restore the *synthetic* original row after an expected accidental delete before finishing, so other tests are not contaminated.
2. Capture actual GitHub M04 RED failure while the baseline fixture still allows the delete.
3. Implement **one** minimal `BEFORE DELETE ON auth_sessions` trigger in `tests/fixtures/m04-auth-migrations/0001_auth_core.sql` to reject all physical deletes. Preserve SQL revocation UPDATE, normal heartbeats, and issuance of fresh session fingerprints. Do not touch production `migrations/**` or `src/**`.
4. Run M04 actual Workerd/D1 and complete GitHub CI, account for any source-verified unit/schema test expectation changes without relaxing denials.
5. Inspect the final file inventory, latest `main` mergeability and full current-head checks, and leave a reviewable PR.

## Safety, retention, and non-goals
- **Physical session-row pruning is intentionally unavailable under this fixture trigger.** Production retention, expired-token cleanup, revocation/tombstone lifetime, storage cost, and an authorized purge procedure require **M03 schema-owner and owner approval** before any real D1 migration. Do not pretend this solves arbitrary privileged SQL: an actor able to drop triggers or tables can bypass them.
- This proposal does not alter the public Worker, RPC registry, frontend, source GAS/Sheets, production or staging D1, credentials, or deployment.
- A future cleanup design must not allow previously issued bearer fingerprints to be reaccepted while their token might remain usable; consider bounded irreversible tombstones and time-bound deletion only with verified token expiry and authenticated administrative change control.
- Public login continues to be unavailable; `PARALLEL-MODULE-READY` stays unclaimed.
