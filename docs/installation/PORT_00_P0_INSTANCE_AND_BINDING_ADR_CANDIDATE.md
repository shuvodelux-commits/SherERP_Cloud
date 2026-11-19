# PORT-00 / P0 — Instance-specific configuration audit and Shop D1 topology ADR candidate

**Date:** 2026-11-20 (Asia/Dhaka)  
**Status:** REVIEW CANDIDATE, **NOT an approved topology, install script, P1 configuration implementation, or remote deployment authority**.  
**Issue:** [#699](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/699); related [#690](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/690), [#456](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/456).  
**Main source audit:** `7803abdbc8b2586d48534ec6ff2a009d2ce59735`.  
**Ownership:** PORT-00 planning owns this document only. M03 owns all generated Wrangler binding, Worker entry, D1 and common runtime implementation; M04 auth; M11 deploy safety; M10 migrations/restore.

## 1. Recorded instance-specific points (verified representative source)

| Source file | Currently coupled item | Proposed instance configuration |
| --- | --- | --- |
| `wrangler.preview.jsonc` | Public `hisabiq` asset/Worker shell | Keep separate, **DB-free**, no secrets, preview URLs remain isolated |
| `wrangler.staging.jsonc` | Existing Worker name, Staging D1 and History Archive database names/UUIDs | Per-instance main/test Worker profile, explicitly verified DB IDs and migration version; archived business never auto-imported |
| `wrangler.m03-platform-auth-access-staging.jsonc` | Cloudflare account ID, private admin Worker name, allowed origin, Control D1 ID/name, rate-limit namespace ID | Generated private Control Worker manifest; owner-approved Cloudflare account, hostname, Control DB and limiter IDs; no current-account UUID copied |
| `src/m03-access-platform-auth-worker.js` | Source-level `ADMIN_ORIGIN` fixed to one `workers.dev` host, also compared with `PLATFORM_AUTH_ORIGIN` | Remove only the source hardcode in a separate M03 P1 PR; validate exactly one trusted HTTPS origin from deploy configuration; preserve runtime Access-denial checks |
| `src/m03-private-platform-auth-worker.js` | `PLATFORM_CLIENT_ID`, `PLATFORM_AUTH_ORIGIN`, `PLATFORM_AUTH_SCOPE`, `PLATFORM_INGRESS`, `CONTROL_DB`, feature flags | Required values and per-environment feature flags in a validated manifest; Google client is public configuration, not itself a secret |
| `src/auth/platform-superadmin-bootstrap.js` | Trusted Control D1, one-time subject-bound setup ticket and Google client ID | Fresh-account first-admin bootstrap procedure and secret handling; no default account or password |
| `src/auth/platform-shop-binding.js` | Pilot-only `PLATFORM_PILOT_DB`, `PLATFORM_PILOT_SHOP_ID`, `PLATFORM_PILOT_D1_ID`, `PLATFORM_PILOT_MARKER` | **Explicit blocker**: pilot is one configured Shop D1, not dynamic business provisioning. Preserve fail-closed D1 identity and marker checks |
| `src/m03-owner-redemption-worker.js` | `OWNER_AUTH_ORIGIN`, `PLATFORM_AUTH_ORIGIN`, `PLATFORM_OWNER_CLIENT_ID`, `CONTROL_DB`, rate limiter, authorization/release flags | Separate exact-HTTPS Owner origin + approved account bindings, not a client-selected target |
| `staging-migrations/platform-auth/**`, `staging-migrations/platform-onboarding/**`, operational Shop D1 migrations | Existing versioned Control and Shop D1 schema queues | Installer must verify migration state, ownership, backups and exact target before any future remote write |
| `docs/runbooks/M03_PLATFORM_AUTH_STAGING.md` | Existing private-host Access and approved-operator procedure | Replace host/IDs with generated new-account values; retain Access on **entire** private host including assets/API |
| `docs/installation/START_HERE.md` | Planned installation checklist, not executable | P1–P6 follow documented manual approvals; do not claim runnable installer yet |

This is a **representative inspected-source inventory**, not a completed repository-wide scan. Before declaring P0 done, enumerate **every** checked-in `wrangler*.jsonc`, Worker entry, Control/Shop D1 binding, GitHub deploy workflow and relevant runbook for account IDs, D1 UUIDs, literal hostnames, Google IDs, namespace IDs and secret key names. Do not print actual credential values or produce logs containing live customer/staff records. Use a deterministic scan and review false positives, synthetic test IDs and legacy source literals separately.

## 2. Cloudflare constraints verified 20 November 2026

- A D1 database becomes `env.BINDING` only through a **declared Worker binding**, not merely because an arbitrary database UUID appears in Control D1 or browser input. See [Wrangler D1 bindings](https://developers.cloudflare.com/workers/wrangler/configuration/#d1-databases) and [Worker D1 API](https://developers.cloudflare.com/d1/worker-api/d1-database/).
- Cloudflare documents ~5,000 D1 bindings per Worker script (metadata-limited), **10 D1 databases per account on Workers Free**, and much larger paid account quotas. These are limits, **not an approval to use any number without provisioning/deploy tests**: [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).
- Workers account limits: **100 Workers Free / 500 Workers Paid** as of the referenced limits page. A **separate Worker per business** is not a viable uncomplicated 500-shop default; [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
- [Worker service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/) can connect predeclared Workers; they do **not** bypass the need for a trusted, deployed target binding.
- Worker/D1 free usage quotas must not be portrayed as capable of sustaining ~500 isolated businesses; verify actual account plan and quotas before onboarding.

## 3. Proposed KISS decision — REVIEW REQUIRED

**Candidate A (recommended for MVP proof):** retain the existing **separate private Control Worker + Control D1**, and a **single private ERP Worker** with an explicitly generated set of **static, named D1 Shop bindings**. Each Shop has its own D1. A server-verified Owner session, tenant identity and immutable Control D1 placement record choose only an allowlisted published binding. The browser never supplies a database UUID, binding name, account credential or alternate business authority.

Why: one reviewed ERP codebase, no mandatory Worker per shop, and no Workers for Platforms base subscription solely for identical ERP code. A private builder/deployer can later create a Shop D1, apply versioned migrations, publish an updated **instance-specific binding manifest**, deploy the new ERP Worker version and verify the resource marker before marking the Shop active. **Creating a D1 alone is not binding publication.** The deployment owner, safe serialized reconfiguration and rollback are unresolved P2/P4 work; **do not add an independently competing deploy mechanism** to the existing Worker Builds owner. Gate the first release at only **two disposable shops** until CI and failover tests prove the approach.

**Reject for default MVP now:**
- One public Worker dynamically opening any D1 UUID from a client or Control D1 row (unsupported authority/unsafe trust).
- One dedicated Worker for every shop without proven deployment quotas, costs and lifecycle automation.
- Workers for Platforms, a VPS, PostgreSQL, React rewrite or billing stack solely to simplify the pilot.
- Copying production D1 data or operator credentials into a new account's fresh install.

**Candidate A caveat:** static binding metadata requires Worker version updates. A safe provisioning state must not say `active` until the deployed Worker actually has the binding and passes identity/authorization smoke tests. A failed Worker deployment must leave the shop `pending`, with a resumable operator operation ID. Deployment rollback must not redirect an active shop to another database. Explicitly measure binding/version limits and installation propagation before selecting the long-term scale topology.

**Alternative B (only if A fails quantified gates):** a bounded set of private shard Workers, each with generated static named Shop D1 bindings, coordinated by trusted server-side routing and placement. This is a future decision with its own tested service-binding/deployment topology, not automatic P0 scope.

## 4. Minimum instance configuration contract for P1

Only these categories belong in a versioned, validated **gitignored per-install generated config**; never in application logic:

1. Account/installation identity: Cloudflare account ID, release SHA/schema version, environment (local/test/private staging/prod), separate Worker names and full approved HTTPS origins.
2. Control resources: Control D1 name/UUID/binding, archive capability (optional and separately approved), versioned migration directory, rate-limit namespace and Access app audience.
3. Identity: Google OAuth Web client ID, approved JS origin/redirects, first-admin approved Google subject, operator email and required MFA bootstrap state.
4. Shops: immutable Shop UUID, Shop D1 ID, marker, schema version, unique published binding name, deployed Worker version, provisioning state, source role-account authorizations and revocation generation.
5. Secrets: scoped deployment API credentials and any truly needed OAuth code-flow secret, session-signing/encryption key and TOTP/recovery values stored only as protected secrets; config records references, not values.
6. Release flags: a clear inactive default for private writes, product save, purchases, POS, returns and historical imports; public preview has **no** D1 or private bindings.

**P1 fail-closed rules:** wrong account, duplicate binding name, missing D1 identity, unsafe host, mismatched origin, unresolved provisioning state or unknown database version → refuse deployment/routing. A freshly copied account cannot reuse original Cloudflare account IDs or `workers.dev` namespace names.

## 5. Required proof and owner signoff before P1/P4

- [ ] M03 owner verifies complete repository scan and controls generated Wrangler/deploy files.
- [ ] Owner approves or amends Candidate A vs B using explicit two-Shop local/empty-account evidence.
- [ ] M11 confirms a **single** deployment owner, protected private origins and fail-closed public preview.
- [ ] Test two separate D1 bindings with deliberately identical internal source IDs; deny all cross-Shop reads/writes.
- [ ] Simulate missing binding, stale Worker version, swapped DB identity, duplicate provisioning, rate-limit/quota denial and interrupted deploy; Shop remains `pending` and safe to resume.
- [ ] Verify first Super Admin one-time Google + MFA/Access path and separate Owner permission path without creating default privileged credentials.
- [ ] Test original ERP financial integration **separately** with approved M02/M08/M03/M04 gates.
- [ ] Record exact provider plan/quotas and Cloudflare API permissions before claiming a 500-Shop or one-click release.
- [ ] Preserve P0 as **audit/design only** until review, then implement P1 validation as a test-first, M03-owned scoped PR.

**Release effect of this document: none.** No Worker, D1 resource, secret, route, Google configuration, Owner login or financial posting was changed.
