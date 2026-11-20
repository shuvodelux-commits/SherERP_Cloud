# SherERP Super Admin — trusted 15-day login and safe deployment

## What changed

The original Super Admin login already required an approved Google
Identity Services ID token plus a 6-digit TOTP factor. The *server-side*
Control D1 login session and the browser HttpOnly cookie both expired
after only 15 minutes. This release changes **both** to a fixed absolute
15-day expiry, including the first-browser enrollment path.

A new browser/device still has no valid, device-local, HttpOnly session
cookie and must complete Google **and** TOTP. The existing same browser
can restore its authenticated Admin UI without repeated MFA during those
15 days. No fingerprinting, IP trust, localStorage secret, automatic
session renewal or background MFA bypass was added.

Logout revokes this particular session immediately. The Control D1
session also fails when the Admin is disabled, its MFA factor version
is updated, or the session is revoked/expired. Clearing cookies/private
browsing forces full Google+TOTP again. A stolen session cookie would be
highly sensitive for 15 days: use only personal, locked, updated devices;
do not use a public/shared browser. Sensitive MFA-management and
recovery operations must perform a *separate recent-factor verification*.

### If an authenticator phone is lost

**Do not disable MFA, delete Admin D1 tables or use Google identity
alone as an emergency bypass.** Keep a separately stored offline
recovery code or an additional authenticator already enrolled *before*
the phone is lost. If no recovery method was provisioned, a separately
reviewed, offline operator-controlled recovery procedure with account
ownership verification, backup, audit and explicit credential/session
rotation is necessary; a normal login cannot safely self-reset TOTP.
A subsequent PR introduces scoped single-use recovery codes and
re-enrollment without exposing a public MFA bypass. The 15-day session
release alone does **not** claim recovery codes are ready.

## Exact deployment target and caution

The **Admin** is Worker `admin` at
`https://admin.hisab.workers.dev`, *not* the root/public Worker
`hisabiq` and *not* Shop Owner Worker `shererp`. The current
one-Shop pilot uses:

- Control D1 `shererp-admin-control-v2`
- Existing Shop D1 `shererp-shop-001`
- The Admin entrypoint `src/auth/m04-accessless-platform-admin-worker.js`
- Account-scoped **ignored private config** at
  `.wrangler/hosted-pilot/admin.pilot.jsonc` (never Git commit it)

The private profile is installed only on the authorized operator's
computer. It contains the actual Worker name, account, Google client ID,
original Shop identity and full D1 bindings. Preserve the installed
`PLATFORM_BOOTSTRAP_CODE` and
`PLATFORM_FACTOR_ENCRYPTION_KEY` **as Cloudflare Secrets**; never echo
their values, add them to vars, or regenerate them when redeploying.

### When the PR is reviewed/merged and CI is green

On the authorized CachyOS PC:

```bash
# Review a fresh checked-out commit from main, not an old local copy.
cd /home/shoaib/SherERP_Cloud
git fetch origin main
git worktree add /home/shoaib/shererp-admin-reviewed-release origin/main
cd /home/shoaib/shererp-admin-reviewed-release

# Use an already installed, reviewed private Admin config, including
# the exact Control DB and first Shop DB bindings. Keep it ignored.
mkdir -p .wrangler/hosted-pilot
cp /home/shoaib/shererp-hosted-shop-link-20261120/.wrangler/hosted-pilot/admin.pilot.jsonc \
  .wrangler/hosted-pilot/admin.pilot.jsonc

# Install dependencies matching lockfile, then verify the target and dry-run.
pnpm install --frozen-lockfile
npx wrangler whoami
npx wrangler deploy --dry-run --config .wrangler/hosted-pilot/admin.pilot.jsonc

# IMPORTANT: after confirming the correct account, Worker, D1 bindings,
# exact reviewed SHA and successful Admin tests, deploy ONLY Admin:
npx wrangler deploy --config .wrangler/hosted-pilot/admin.pilot.jsonc --keep-vars

# Verify that a signed-out request still fails and the Admin UI is served:
curl -I https://admin.hisab.workers.dev/
```

**Do not use** `npx wrangler deploy` without `--config` in this
repository, or `wrangler.toml` from the public ERP. Do not apply
remote D1 migrations for the 15-day session change: it is code-only.
Do not touch `shererp` Owner Worker or its Cloudflare Builds settings.

Cloudflare Workers Builds can automatically overwrite manually
deployed Admin code on the next merge if the Worker is still
auto-promoted by Git integration. Before deploying, check **Cloudflare
→ Workers & Pages → admin → Settings → Builds** and disable
competing automatic production deployments (or use a reviewed
`wrangler versions upload` nonpromoting command). Designate one
authorized Admin release process. `--keep-vars` protects dashboard
plain vars; it does **not** replace verification of all existing D1
bindings, version hashes or Cloudflare secret persistence.

Post-deploy acceptance:

1. Existing Admin login, Google/TOTP, D1 Control Center and first
   Shop roster still load.
2. A **fresh** session (new Google+TOTP login) persists after closing
   and reopening the *same* browser.
3. Incognito or a different device requires Google+TOTP.
4. Explicit logout and server-side revocation block all further Admin
   reads and writes immediately.
5. Session naturally expires after 15 calendar days. The old 15-minute
   sessions issued before deployment do not get an automatic extension.

Recovery codes and factor rotation are a **separate, gated release**.
Never imply this session-only deploy also installs them.
