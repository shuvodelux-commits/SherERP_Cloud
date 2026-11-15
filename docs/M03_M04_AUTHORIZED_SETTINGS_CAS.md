# M03/M04 — Atomic Administrator-Authorized Shell Settings CAS

**Status:** Internal compatibility implementation against **M04's proposed test-only D1 auth schema** and M02's existing Settings schema. **Not a deployed authenticated Settings RPC or a production access policy.**

## Original source contract

Pinned source: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

- `Settings.gs:updateSettings(token,payload)` requires `settings.edit` for the current authenticated user, restricts editable keys, and permits partial updates.
- `Utils.gs:sanitizeInput_` trims text before saving.
- `Database.gs:setSetting_` overwrites an existing Settings key or appends a missing key.
- M03 PR #85 implemented an internal SQL compare-and-set update **without authentication** for existing `Shop Name` and `Currency Symbol` rows only. This PR **does not change** that API; it adds an alternative, independently guarded internal implementation for eventual trusted integration.

## New narrow internal contract

```js
import {createM04AuthorizedShellSettingsUpdateAdapter}
  from './src/db/m04-settings-update.js';

const result=await createM04AuthorizedShellSettingsUpdateAdapter(env)
  .updateExisting_({
    token: '<raw 64-lowercase-hex M04 session bearer>',
    nowMs: 1800000000000, // trusted Worker clock, never from client body
    key: 'Shop Name',
    newValue: '  নতুন দোকান  ',
    expectedValue: 'Original Shop'
  });
// {updated:true} only after one-row D1 UPDATE RETURNING proves success
```

This is a **server-only** API. The token must be obtained from M04's authenticated session transport, never a forged client actor ID; the clock must come from trusted Worker code. The request must have exactly the five own data properties shown; it rejects accessors, extra keys, role/actor claims, SQL strings, invalid bearer formats and unsafe value coercion. Only two existing Settings keys are accepted. `Shop Name` is trimmed and must not be blank; `Currency Symbol` is trimmed and may be blank. The old D1 value must match **exactly**. No new key insertion, deletion, mass update or private Settings access is implemented.

### Single-statement authorization is the safety property

`src/db/m04-settings-update.js` computes `SHA-256` over the 32 decoded token bytes, exactly matching the M04 session hash. One fixed parameterized statement performs

```sql
UPDATE settings SET value=?
WHERE key=? AND value=?
  AND EXISTS (
    SELECT 1 FROM auth_sessions s
    JOIN auth_users u ON u.user_id=s.user_id
    WHERE s.token_hash=? AND s.revoked_at_ms IS NULL
      AND s.created_at_ms<=? AND s.expires_at_ms>?
      AND s.last_activity_at_ms>? AND s.last_activity_at_ms<=?
      AND u.status='Active' AND u.credential_state='Modern'
      AND u.auth_version=s.user_auth_version
      AND u.credential_version=s.credential_version
      AND u.role_name='Administrator'
      AND s.role_auth_version IS NULL
  )
RETURNING key,value;
```

The idle window is exactly `AUTH_POLICY.sessionIdleMs` (30 minutes). A revoked, expired or invalidated user/session cannot authorize the write **after** revocation, even if a JavaScript caller previously loaded a valid user profile. A stale Settings preimage also refuses the write in the **same** mutation. SQLite serializes two concurrent updates so only one can update a changed preimage; neither role authority nor stale values can be overridden by cached JS state.

The `auth_sessions` and `auth_users` tables here are from the M04 **nondeployable auth migration proposal**, not from production/staging. Custom roles are intentionally denied, even when their permissions JSON grants `settings.edit`, because the source-faithful M04 permission mapping and authorization contract are not yet approved for production. This deliberately provides an **Administrator-only proof**, not final M04 staff RBAC parity.

`null` from D1 yields the same generic refusal regardless of unknown token, stale/absent key or disallowed role; the adapter cannot disclose the cause. Driver exceptions, missing Web Crypto or inconsistent result shapes fail as `NEEDS_REVIEW` (uncertain result, no auto-retry). The helper does not update session activity; read/write permission cannot be inferred from its JS return alone for any future second statement.

### Tenant, deployment and accounting boundaries

M04's proposed `auth_sessions` has **no tenant_id**. This design therefore assumes **one business per isolated D1**. It cannot be reused as-is in any shared multitenant D1. Neither this SQL nor the tests approve production auth/receipt/Settings migration or public RPC enablement; M04's real role mapping, schema review, trusted session middleware, account import and cutover need separate approval.

No new staging/production migration, preview DB binding, `src/index.js` or `src/rpc/**` change; original 84 source files and original UI are untouched. No cash, bank, ledger, Party, inventory or invoice writer. Reverting the PR removes the internal helper, test fixture/import and documentation without affecting live data.

## Superpowers RED → GREEN evidence

Plan: `docs/superpowers/plans/2026-11-15-m03-m04-authorized-settings-cas.md`.

1. Tests were committed **before** implementation on GitHub: `tests/m03-m04-settings-auth.test.mjs` uses `node:sqlite` and both unchanged M02/M04 DDL fixtures. It checks successful Administrator CAS, a custom role with explicit settings permission being denied, user disable/re-enable, credential epoch and role reassignment, expiry/inactivity/revocation, concurrency, strict input and uncertainty handling.
2. Actual Workerd+D1 tests in `tests/integration/m03-m04-settings-workerd.spec.mjs` use an isolated fake UUID `00000000-0000-0000-0000-000000000013`, apply unchanged M04 test schema and existing M02 catalog DDL, test a **real M04 PBKDF2 login-issued bearer**, check actual D1 CAS and guard against public Worker routes. `tests/integration/m03-workerd.spec.mjs` imports this suite for no-secret CI.
3. **RED CI** on `c4a0560`: Node regression failed with `ERR_MODULE_NOT_FOUND: src/db/m04-settings-update.js`, the expected missing adapter. No mock success was claimed.
4. **GREEN implementation** is `334d92e`. Refer to GitHub Actions on the final PR head for exact passed test counts and Cloudflare Preview status; do not infer green until CI finishes.

**PARALLEL-MODULE-READY remains false.** This narrowly proves a security property of local D1 and does not mean SherERP Settings, login or accounting have been deployed.
