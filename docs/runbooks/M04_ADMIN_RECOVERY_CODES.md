# M04 — Super Admin MFA recovery with one-time backup codes

**Status:** Implemented on the reviewed recovery branch. **Not installed on the live Admin.**
Enable only after CI, independent security review, a verified Control D1 export/restore
and migration `0005_platform_admin_recovery.sql` are approved.

## User flow

1. Sign in to Super Admin using the existing approved Google account plus
   current TOTP authenticator. The 15-day trusted browser is a separate feature.
2. Open **Authenticator recovery and backup codes** on the existing Admin dashboard.
   Enter the **current** six-digit authenticator code and choose
   **Generate 8 backup codes**.
3. The 8 distinct 128-bit codes are displayed **only once**. Copy them into an
   offline password manager or protected printed sheet **separate from the phone**.
   Do not take a public screenshot, send them by email, or save them in GitHub.
   Creating a new set replaces all earlier codes.
4. If the authenticator phone is lost, open
   `https://admin.hisab.workers.dev`, select **Lost authenticator? Use a recovery code**,
   verify your **same enrolled Google identity**, and enter one unused backup code.
5. The code is consumed immediately; a **10-minute** private session shows a QR
   and manual key for a **replacement authenticator**. Enter a six-digit code
   from the new authenticator to finish.
6. On successful confirmation, the factor version advances, the previous
   encrypted authenticator is replaced, **all older Admin sessions and
   recovery codes are revoked**, and eight **new** single-use recovery codes
   are shown once. Save these immediately before leaving the page.

One recovery code can start only the exact nonce-bound Google challenge that
consumed it. Wrong identity, same code on a second challenge, expired pending
flow, wrong replacement OTP, old sessions and previous factor versions fail
closed. A recovery code **alone** never grants Admin access. The database
retains only a SHA-256 domain-separated code digest and AES-GCM encrypted
new authenticator secret. This is not a password/email-only reset.

## If all backup codes are lost

There is deliberately no email-only or Google-only bypass. Recovering
account ownership without an authenticator or any previously issued backup
code requires a separately approved **offline operator-held break-glass
procedure**, identity/Cloudflare account ownership proof, protected D1
backup, audit and credential rotation. Do **not** disable MFA, recreate the
Super Admin identity, delete its Control D1 rows or change the MFA secret
manually to solve a lost-phone problem. Those actions can permanently lock
out the business or create a takeover path.

## Deployment gate — current Cloudflare account

The current Admin Worker is `admin` at
`https://admin.hisab.workers.dev`; the correct entrypoint is
`src/auth/m04-accessless-platform-admin-worker.js`.
Control D1 is `shererp-admin-control-v2`. Shop D1
`shererp-shop-001` must remain bound and unchanged.

1. Merge the 15-day session PR #841 and this separate recovery PR after all
   checks pass. Verify there is only **one** Admin production publisher;
   inspect Cloudflare **Workers & Pages → admin → Settings → Builds**
   before a manually approved promotion.
2. Take a protected remote Control D1 backup, verify it can be restored into
   isolated SQLite/Workerd and read the current Admin Google+MFA metadata
   without exposing values. Never use a Shop D1 as a migration target.
3. Review the exact `0005_platform_admin_recovery.sql` contents and its
   additive schema; apply the migration **once to the authorized Control D1**
   only after confirming the first four auth migrations and local backup.
   No existing MFA factor or session must be modified by this DDL.
4. Use the existing ignored private Wrangler config
   `.wrangler/hosted-pilot/admin.pilot.jsonc` in a fresh checked-out
   reviewed `main` worktree, not the repo's default public Worker config.
   Verify it still binds the correct account, Control D1, first Shop D1,
   Google client, Host origin and ingress limiter. Preserve both existing
   Cloudflare Secrets `PLATFORM_BOOTSTRAP_CODE` and
   `PLATFORM_FACTOR_ENCRYPTION_KEY`.
5. Start the deployed code with `PLATFORM_ADMIN_RECOVERY_ENABLED=false`
   or absent. Execute `wrangler deploy --dry-run --config
   .wrangler/hosted-pilot/admin.pilot.jsonc`. After the Admin release is
   approved, promote **only Worker `admin`** while keeping all existing
   bindings and secrets.
6. Read back the actual migration tables, Admin session and login,
   code-generation authorization, one-time Google+code recovery, and
   factor rotation in approved staging. On confirmed success, opt in to
   `PLATFORM_ADMIN_RECOVERY_ENABLED=true` with the protected config
   change and a separate release. Never toggle it before migration.
7. **Immediately create and save recovery codes** with your current
   authenticator. Test only in an approved disposable/staging Admin
   environment; do not consume the live recovery code just to demonstrate
   correctness.

### Tested software behavior

- Six digits from current TOTP required to issue codes.
- Eight random 128-bit codes displayed once; server stores only hashes.
- Google nonce+subject+single-use code required to begin; code consumed
  against exact challenge hash.
- New TOTP verification required for success; pending expires within 10m
  and locks after 5 bad codes.
- Factor and Admin sessions rotate atomically. New browser requires Google
  and TOTP. Existing trusted session lasts at most 15 days.
- Account-auth and Owner login browser tests must stay green.

**Do not claim this is ready on production** merely because PR is merged.
The database migration, flag, preserved deployments and first code-generation
are explicit, independent live acceptance gates.
