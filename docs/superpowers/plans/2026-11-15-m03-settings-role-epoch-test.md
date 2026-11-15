# M03/M04 — Settings role-metadata epoch regression alignment

**2026-11-15.** Source pinned to `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Read `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, and M04 source contract. Coordinate M03 owner approval of the test before merging.

## Repro / RED evidence

The owner-approved M04 change [PR #106] (merged `95beb989`) adds `allowed_modules` to the M04 *test-only* `auth_roles` epoch trigger. This intentionally revokes sessions whenever the source role navigation metadata changes, because existing sessions must not retain stale role projections.

The older `tests/m03-m04-settings-auth.test.mjs` case `active custom role with literal settings.edit true can CAS an existing row inside the same SQL guard` changes `auth_roles.allowed_modules` but attempts to authorize the UPDATE using the **old role_auth_version=1** session, mistakenly expecting success. This now fails: `Denied or stale Settings precondition`. This is a stale test expectation, **not** an authorization defect. GitHub [PR #30] Foundation job `43698548499` and fresh rerun `43698624871` reproduced this exact test failure; other M03 Settings security tests passed.

## Smallest safe correction (test-only)

In this single synthetic test, retain the deliberate `allowed_modules=''` metadata change and first assert that the original old token `C` is **denied**. Read current `auth_roles.auth_version`; insert a *new* synthetic session for the same active Cashier with a fresh bearer token and the current role epoch. Then assert the original `settings.edit === true` permission authorizes the CAS update even though allowed_modules display list is empty. This proves **both** properties: metadata edits revoke stale sessions AND UI-only modules cannot grant or deny permission inside D1 SQL. Do **not** rewrite the old session epoch in-place as if an attacker could refresh authority.

## Test-first completion

The existing failing test is RED in GitHub CI before this PR. Apply only the test-case correction, run fresh Foundation node/source + all real Workerd/D1 + Chromium/preview safety checks on this PR, record results. The M03 owner must review this contract reconciliation before merge.

## Change scope / ownership

Only `tests/m03-m04-settings-auth.test.mjs` and this plan. Never edit shared `src/db/**`, `migrations/**`, test-only auth SQL, public RPC/Worker, original source/frontend, Cloudflare configs, secrets, actual staff or remote D1. No runtime behavior is weakened; role invalidation remains fully enforced. Public login is still 503; business RPCs 501.

## Related security gate

Old draft M04 PR #30 adds source-audited internal permission maps and Proxy fail-closed behavior. Its latest CI caught this independent preexisting test mismatch; it **must not** bypass the test or ship with failing CI. Once the M03 owner reviews and merges this test-only correction, rerun/update #30 CI before approving its integration.
