# M04/M03 Owner session deadline — test-first hardening

Base `main@f7f36da`; reservation in issue #456 comment 7035088995; PR #783. The prior Owner cookie was advertised for one year while the Control D1 placement lookup ignored `issued_at_ms` entirely. The private UI and Shop HTTP APIs perform a live Owner placement lookup on each request, but stale tokens could continue to read or submit writes until explicit revocation. Do not confuse cookie expiry with server-side authentication.

## Boundary

* One absolute, server-enforced 12-hour bearer-token deadline. Only Control D1 SQL time may determine eligibility; reject future or stale issue times. This is not the optional 30-minute inactivity policy.
* Apply to `prepareCurrentOwnerPlacement` for all Owner read/HTTP request paths, and to `publishCurrentOwnerWriteSession` before any new Shop grant publication. Keep the existing shop marker, physical binding, Owner enable state and generation checks.
* Private HTTPS Host-only cookie Max-Age must be at most the server-side lifetime. Session rotation and logout still fence old grants.
* Regression uses real disposable Workerd/D1 two-shop provisioned test: fresh login works; the now-expired bearer token is denied for session, catalog read, product POST and grant publication, leaves both product and receipt counts unchanged; future issue time denies.

## Intentional scope and release blockers

This change does **not** add independent expiration to the pre-existing Shop D1 `shop_owner_write_grant` row. A later M03 integrator-controlled migration and SQL-time guard will be needed before exposing any new writer that can bypass a fresh Control session lookup. Do not activate hosted finance or arbitrary Owner SQL APIs based on this fix. Original UI, source archive, public Worker, RPC registry, D1 migrations, accounting and hosted resources remain untouched. QA should verify 12-hour boundary at Worker/Control and investigate claim fencing after natural expiry. A user-approved full authenticated source-faithful sale/return/reconciliation and M10/M11 recovery rehearsal remain release blockers.

Test-first RED GitHub commit: `1f53e457e8575fc7ba1afe0243fc250ab9c85422` (inspect Actions for observed failure, do not infer it). GREEN runs on PR #783 exact head and requires independent review before merge.
