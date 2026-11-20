# M03 Option A — Private Shop D1 Provisioner Worker (P2c)

**Status:** Code and deployment profile prepared; private Worker is **NOT deployed**
and its release flag defaults to `false`. No live Cloudflare token, remote
database creation, migration, Worker version publication or Owner access has
been enabled by this PR.

## Reused implementation

The Worker in `src/m03-private-shop-provisioner-worker.js` does not replace
the existing Super Admin interface or the PORT-P4 Create/Resume state machine.
It imports:

- `reserveHostedShop`, `advanceHostedShopCreate`,
  `readHostedShopCreate` from the P1 protected Control D1 journal;
- `createCloudflareD1Provider` (exact account, D1 quota and one creation
  attempt after the journal claim);
- the current Google+TOTP Super Admin D1 session validator.

## Private service-bound contract

This Worker must be accessible through **only** an authorized Cloudflare
service binding from the private Admin Worker, not a public route.

- No public hostname, custom domain, `workers_dev` URL or preview route.
- The internal origin is exactly `https://provisioner.internal` and
  accepts POST only on:
  `/internal/shops/reserve`, `/internal/shops/advance` and
  `/internal/shops/status`.
- The internal Admin caller forwards the current MFA-backed opaque Admin
  session token only inside the service binding, not as a URL query, and
  supplies the 64-character `x-provisioner-key` secret. The provisioner
  **independently rechecks** session and MFA factor version in Control D1
  before constructing the Cloudflare API provider.
- Request body fields are exact and small; browser-supplied Cloudflare
  account IDs, D1 UUIDs, migration SQL, release SHA, Worker name and
  arbitrary actions are rejected. No CORS/browser session cookie is used.
- Worker responds only with sanitized Shop UUID, operation ID, creation
  state and safe failedStage. No Cloudflare API token, D1 receipt or
  reusable Owner token is returned.
- D1 creation is **not** Shop Ready. Owner Gmail approval, migration,
  immutable Shop identity, active Worker binding and Owner authentication
  must all pass separate P2/Task 5 gates.

## One-time Cloudflare installation (future approved release)

Generate the non-public config with:

```bash
node scripts/m03-private-provisioner-deploy.mjs --generate .wrangler/operator-provisioner-input.json
npx wrangler deploy --dry-run --config .wrangler/private-provisioner.jsonc
```

The operator input is an **ignored**, private JSON with `accountId`,
`controlDbName`, `controlDbId` and allowed `maxDatabases`. Keep it under
`.wrangler`, never GitHub. The generator writes an ignored
`.wrangler/private-provisioner.jsonc` with permissions 0600,
`workers_dev:false`, `preview_urls:false`, and a single Control D1.
Its `PROVISIONER_RELEASE_ENABLED` flag is **false**.

Only after independent Task 4 Worker publisher and dynamic Owner routing
have passed two-Shop isolation and release QA, the approved operator may
deploy this exact nonpublic Worker and set the following secrets:

| Worker | Protected setting |
| --- | --- |
| Private Provisioner | `PROVISIONER_INTERNAL_KEY` (64-character random secret) |
| Private Provisioner | `CLOUDFLARE_API_TOKEN` scoped to reviewed D1 create/list only |
| Private Admin Worker | The same `PROVISIONER_INTERNAL_KEY` secret, plus explicit service binding to `shererp-provisioner` |
| Private Provisioner | Fixed, verified `PROVISIONER_ALLOWED_ACCOUNT_ID` and `PROVISIONER_MAX_DATABASES` variables |

Never copy the Cloudflare API token into Super Admin frontend, Owner
Worker, public Worker, GitHub PR/Build environment or logs. D1 migration
and Worker Versions publication may require **different**, separately
approved credentials. No token with broad account privileges.

Do **not** set `PROVISIONER_RELEASE_ENABLED=true` or connect the
live Admin Create Business route in this phase. Cloudflare D1 create
may have an unknowable outcome after a network timeout; the journal
must then remain `outcome-unknown`, and never silently issue a second
POST or activate an unverified database.

## QA

- Workerd/D1: unauthorized session, wrong origin, invalid internal key,
  unknown actions and malformed body return denial with **zero provider
  calls**; current Admin can reserve/advance/read an immutable journal;
  revoked MFA prevents creation; no Owner is approved yet.
- Contract: profile has no routes, secrets or public URL and defaults
  disabled, validates exact account/Control D1 identities.
- Wrangler `--dry-run` must bundle under 40 KB, show only Control D1
  and the disabled provisioner settings.
- Existing P1 `m03-hosted-shop-journal` and provider tests remain green.

**This is a backend security boundary, not a UI feature or production
go-live.** Financial writers, Shop Owner Workers Builds, dynamic Shop
routing and prior tenant data are untouched.
