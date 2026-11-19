# PORT-00 P2 — Run 1: read-only Cloudflare bootstrap preflight

**Status:** review-only. **NOT account bootstrap complete, NOT a Cloudflare deployment, NOT remote migration authority.** Issue [#699](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/699), M03 #22, clean shop #690, M11 #306, M10 #312.

P1 already validates the manifest and creates inactive, Git-ignored local Wrangler drafts. P2 Run 1 adds a strictly read-only Cloudflare account/resource identity check and a no-network setup plan. It does not create Control/Shop D1, Workers, Access apps, Google OAuth clients, secrets or a Workers Builds connection. It does not run remote D1 SQL, change tenants, enable ERP writes or alter public preview.

## Prerequisites

- Work from the reviewed GitHub release and the intended **new Cloudflare account**. Never copy live pilot Worker names, account ID, UUIDs, host, token or business data into that account.
- The ignored local **.wrangler/instance.json** must pass the P1 strict manifest validation. For the read-only check, its nominated Control D1 and pilot Shop D1 must **already exist**.
- For remote GET checks only, supply **CLOUDFLARE_API_TOKEN** in the local operator environment. Use an account-scoped token with permissions to get Account Details, Workers Subdomain and D1 Database metadata (for example Account Settings Read, Workers Scripts Read, D1 Read as applicable). Never commit, screenshot or print secrets.
- Cloudflare official API reference: [Account Details](https://developers.cloudflare.com/api/resources/accounts/methods/get/), [Workers Subdomain](https://developers.cloudflare.com/api/resources/workers/subresources/subdomains/methods/get/), [D1 Database](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/get/).

## No-network dry run

1. Follow [P1 local configuration](PORT_P1_LOCAL_CONFIGURATION.md) to create the ignored local manifest.
2. Run:

       node scripts/port-p2-bootstrap-preflight.mjs --dry-run .wrangler/instance.json

3. The output contains only predetermined status codes and remaining-gate labels, never account IDs, database UUIDs, origins, OAuth ID, token or customer data. It explicitly prohibits deployment and remote migrations.

## Optional GET-only verification (after a separate read-only token is available)

1. The nominated Control D1 and pilot D1 must already exist under the intended account.
2. Execute with the token provided securely in the environment:

       node scripts/port-p2-bootstrap-preflight.mjs --verify-readonly .wrangler/instance.json

3. The tool invokes exactly **four GET** API requests: account identity, Workers subdomain, Control D1 details, pilot D1 details. It compares returned IDs and D1 names to the validated manifest and fails closed on denied access, missing permissions, mismatches, unexpected replies or network errors.
4. The tool never follows redirects and never issues POST/PATCH/PUT/DELETE, remote D1 queries, migration or deployment commands. Repeat the GET-only check with the same manifest to establish no-op behavior.
5. **Do not deploy** the generated profiles: they remain inactive. A green identity check does **not** prove Cloudflare Access, Google login, private host safety, tenant permissions or business calculations.

## Still BLOCKED: explicit P2/M03/M04/M10/M11 gates

| Gate | Run 1 evidence | Release owner |
| --- | --- | --- |
| Account, namespace, D1 identities | Pure mock/API contract and optional real read-only check; no live account checked in the PR | Operator / M03 |
| Cloudflare Access on whole Admin and Owner host | Not checked | M04 security/Owner |
| Google OAuth authorized origins, session/MFA | Not checked | M04 and Google Cloud Console |
| Secrets, token scoping, first Super Admin and recovery | Never configured by this script | M04/operator |
| Versioned D1 migrations, backup, restore and rollback | Not performed | M03/M10 |
| Workers Builds, preview isolation, deploy owner | Preview stays D1-free; no live deploy | M11 |
| Per-shop binding topology, quotas, two disposable shop isolation | Only one statically configured pilot binding | M03/M11, #690 |
| Purchase → POS → return and exact financial calculations | No operational posting | M02/M08/M03 and M10/M11 |

**Next P2 run** may propose controlled new-account resource creation and a backup/recovery rehearsal after explicit disposable-account and release approvals. Merging this PR **does not** authorize remote resource creation, SQL migrations, staging or production deployment.

## Local tests

    node --test tests/contract/port-p2-bootstrap-preflight.test.mjs tests/contract/port-p1-instance.test.mjs tests/contract/port-p0-inventory.test.mjs
    node scripts/port-p0-inventory.mjs --check
    npm run verify:source

These are mocked provider-response contract tests and local source checks, **not** proof of Cloudflare hosted release readiness.
