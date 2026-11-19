# SherERP Cloud — Portable installation & multi-tenant platform roadmap

**Planning baseline:** 19 November 2026  
**Tracking issue:** [PORT-00 #699](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/699)  
**Operator guide:** [START HERE](START_HERE.md)  
**Safety status:** **Planning / documentation only; production NO-GO.**

## 1. Product promise and boundaries

**Target promise:** Install the same reviewed SherERP GitHub release into another Cloudflare account with **zero application-code changes**. The operator supplies account-specific IDs, hostnames, secrets, Google OAuth and Access configuration, then follows a deterministic installer. The platform creates and manages businesses from the Super Admin screen; each business has reviewed, isolated storage and properly authenticated Owner/staff access.

**What this does not mean:** The repository is not a populated database backup. New-account configuration and D1 schema migrations are portable; real tenant data, encryption keys, archived books and external identity providers require explicit protected export/import/reconfiguration. Do not auto-import another account's business or create default privileged credentials.

**Existing architecture remains in force:** Cloudflare Workers + D1 + original frontend, Hono where already used, GitHub-first PR review, Superpowers RED → GREEN → refactor → affected/real-Workerd-D1/browser tests, KISS. No speculative React rewrite, no public D1 preview, no bypass of financial reconciliation and M10/M11 approval.

## 2. Observed current baseline (GitHub main review)

| Area | Already present | Portability gap |
| --- | --- | --- |
| Public preview | \`wrangler.preview.jsonc\` deploys a deliberately D1-free Worker with assets | Must stay DB-free; must not serve as a production installation |
| Reserved ERP staging | \`wrangler.staging.jsonc\` references existing Staging D1 and archive D1 UUIDs | IDs and names belong to one Cloudflare account |
| Private platform | \`wrangler.m03-platform-auth-access-staging.jsonc\` has account ID, Control D1 UUID, admin origin, Worker and rate-limit configuration | Needs validated per-install instance configuration |
| Private admin Worker | \`src/m03-access-platform-auth-worker.js\` fixes an Administrator hostname in source and validates Cloudflare Access identity | Replace hardcoded origin with a trusted, validated per-instance origin without weakening host checks |
| Super Admin security | \`src/auth/platform-superadmin-bootstrap.js\` and private platform Worker have one-time Google subject enrollment and session/MFA contracts | Publish the safe bootstrap operator procedure, provisioning gate and recovery mechanism for new accounts |
| Platform Control D1 | \`staging-migrations/platform-auth\` includes bootstrap/session migrations; \`staging-migrations/platform-onboarding\` includes shop/onboarding migrations | Reviewed installer must create/configure exact new Control D1 and migrate with safe backups/version checks |
| New business | Platform UI reserves a business; optional pilot binding, Owner invitation/Gmail approval exist behind release flags | [#690](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/690) requires actual D1 creation, schema, binding and Owner setup, safely retryable from UI |
| ERP modules | M01–M11 migration, tests and runbooks exist | Real integration, financial correctness and production release are still separately gated; see M03/M10/M11 docs |
| Deployment | Cloudflare Workers Builds connected for public shell and GitHub Actions PR-only validation | A fresh account needs a repeatable account-specific setup and deploy-owner policy |

**Important design constraint:** Workers access D1 using declared bindings. Creating a database ID does **not** automatically make it a usable \`env.DB\` binding for an arbitrary shop. Before implementing the shop provisioner, review and choose a supported per-shop Worker/binding/routing topology and verify Cloudflare API permissions, quotas, protection and failure recovery. Do not hide manual per-tenant binding work behind the claim of "one-click setup".

## 3. Installation instance contract (to design and validate in P1)

The checked-in repository should contain **templates and validation**, not one operator's live instance. These are **conceptual fields**, not assertions that an installer or keys already exist:

| Configuration category | Example fields / intent | Location and security |
| --- | --- | --- |
| Account & deploy | Account ID, Workers namespace, desired ERP/admin Worker names, environment and deploy branch | Instance manifest / generated Wrangler files, never hardcoded application logic |
| Access & origins | ERP origin, admin origin, Access application audience, approved platform operator | Instance config with exact-host matching |
| Databases | Control D1 name/ID, shop D1 naming strategy, tenant-to-DB mapping, migration version | Provisioning state + generated D1 bindings; never copy stale UUIDs |
| Google identity | Web client ID, exact authorized JS origins and flow-specific redirect URIs | Per-instance config; secret only if flow requires it |
| Cryptographic & privileged settings | TOTP/MFA seed, any actually required OAuth/JWT/signing secret, provisioning API token | Secure Cloudflare secrets / protected installer store, **never source/config committed publicly** |
| Feature gates | Provisioning, Owner activation, ERP writes, migration/cutover eligibility | Explicit, fail-closed release configuration and audit |
| Verification outputs | Worker host, Control D1 ID, release/schema version, health and security test receipts | Non-sensitive install receipt, not raw tokens/data |

**P1 acceptance:** A strict schema distinguishes required from optional fields; validates account ID/database/Worker/origin consistency; refuses empty or inconsistent secrets; generates gitignored instance config; refuses potentially destructive writes unless exact reviewed target and backup are confirmed. A fresh account needs **configuration changes only**, never source edits.

## 4. Work execution sequence

| Gate | Owner / main dependencies | Deliverable | Evidence to close |
| --- | --- | --- | --- |
| **P0 — Inventory & plan** | PORT-00, M03/M04/M11 review | Source/secret/binding inventory, architecture diagram, config contract, beginner documentation | Reviewed files and decisions; no remote writes |
| **P1 — Portable instance configuration** | M03 single owner for \`wrangler*.jsonc\`, Worker entry and D1 boundaries | Template + validator + generated account-specific configs, fail-closed preflight | TDD against different accounts/origins, missing IDs and wrong D1 binding; no source edits |
| **P2 — Account installer** | P1, M11 deployment ownership | Deterministic Control D1 creation, versioned migration operator, two-Worker setup, protected secrets and Workers Builds wiring | Real empty-account staging rehearsal; backup, repeat/no-op and fault injection |
| **P3 — Secure Super Admin enrollment** | P2, M04 | One-time first-admin setup, Google verification, MFA, Access, revocation/recovery and audit | Real D1/Workerd/browser auth tests; unauthorized requests denied on all paths |
| **P4 — Self-service business provisioning** | P1–P3, #690, M03 shared schema/posting and M04 Owner auth | Admin: business name + Owner Gmail → distinct Shop D1, schema, safe binding/routing, owner enrollment, resumable status | Two shops, no cross-tenant leakage, retry/timeouts/quota/partial failure tests |
| **P5 — Shop operational readiness** | P4, accepted M05–M09 contracts | Empty shop is fully usable for product, purchase, POS, returns, accounts and print | Private end-to-end real Workerd/D1 tests; stock/ledger/cash/session exactness |
| **P6 — Portable restore, operations and handover** | P5, M10/M11 separate GO | Encrypted export/import, cross-account transfer, restoration, version upgrades, secrets rotation, incident/rollback playbook | Independently repeated second-account install + recoverability + owner approval |

### Recommended merge order

1. Documentation-only PORT-00 issue + this guide/roadmap PR (**safe to review while ERP modules advance**).
2. P0 source inventory/decision on tenant Worker↔D1 routing, names, required secrets, costs, installer strategy and permissions. A docs-only ADR can finish before code.
3. P1 instance manifest validator/config generator (one scoped PR owned by M03 integration; tests first). Keep checked-in demo/test Wrangler profiles separate from generated deployment output.
4. P2 bootstrap operator with **fresh, empty D1** and no production import. Owner reviews all remote write commands.
5. P3 first-admin + Access/Google/MFA tests and setup wizard; never bypass existing credentials or enforce fake setup success.
6. P4 full business provisioning in #690; first prove two-shop isolation, then enable admin Create Business.
7. P5–P6 tenant workflow E2E and a second-account clean install; finally M10/M11 launch/recovery gates.

Avoid combining P1–P6 into one risky PR. Public preview remains isolated and D1-free throughout.

## 5. Critical decisions before coding the provisioner

1. **Shop database deployment topology:** How will an authenticated Owner/shop Worker reach that specific new D1 without requiring a human to edit bindings? Decide documented per-shop Worker, controlled routing/service binding, or another reviewed account-supported topology. Prove static binding constraints and permissions.
2. **Provisioning credentials:** Which minimum Cloudflare API operations are needed to create D1 and deploy/bind Workers? Keep credentials server-side, scoped and auditable; never expose to Owner or browser JavaScript.
3. **Plan limits and cost:** Validate per-account Worker/D1/build/API quotas at the intended tenant count. Do not silently assume free-tier capacity. If limits are reached, the dashboard must stop safely with a clear operator message.
4. **Separate authority:** Platform Super Admin can provision/suspend accounts, but cannot silently bypass shop financial authorization or impersonate Owners. Shop Owner is not platform Super Admin.
5. **Database lifecycle and schema upgrades:** Each shop records schema version/provisioning state. Partial setup must remain inaccessible to Owners. Repeating the same request must not duplicate a shop or chargeable resources.
6. **Tenant identity and secrets:** Preserve stable shop identity across Worker/D1 deployments, deny cross-shop reads/writes by default, and specify key/credential rotation and business-deletion retention separately.
7. **Release gates:** Never auto-activate historical data imports, real financial transactions or public RPCs as a side effect of finishing installer scaffolding. Obtain M03/M04/M10/M11 approvals.

## 6. Documentation package for nontechnical installers

Keep one entry point. Proposed long-term pages:

1. **\`docs/installation/START_HERE.md\`** — ordinary-language preparation, ten setup steps, expected screens, troubleshooting; current draft exists.
2. **\`docs/installation/CONFIGURATION.md\`** — each input, where to find it in Cloudflare/Google, whether it is secret, validation, example without live IDs.
3. **\`docs/installation/ADMIN_AND_TENANTS.md\`** — one-time Super Admin onboarding, first business, owner sign-in, shop health states and failure retry.
4. **\`docs/installation/BACKUP_RESTORE_MOVE.md\`** — private backups, source-to-target migration, restore test, verified cutover, key rotations and recovery.
5. **\`docs/installation/TROUBLESHOOTING.md\`** — exact diagnostic errors and safe non-sensitive self-check commands.

Avoid duplicating \`docs/runbooks/M03_PLATFORM_AUTH_STAGING.md\`, M10/M11 evidence or existing migration docs. The public-friendly guide links to deeper operator documents when needed. Add actual UI screenshots only from verified deployed versions, never static guessed instructions.

## 7. Release qualification: second-account test

A second authorized tester must be able to use **a brand-new Cloudflare account and Google OAuth client**:

- [ ] Get the same reviewed GitHub SHA/tag; **do not edit application source or SQL**.
- [ ] Enter instance config, create new Control D1 and Worker resources, and verify versioned schema and release.
- [ ] Verify admin hostname is blocked by Access for unauthenticated/unapproved users, including assets and API.
- [ ] Enroll first Super Admin with single-use identity-bound ticket; verify Google, MFA, session and logout.
- [ ] Provision Shop A and Shop B from the UI, entering only business names and Owner Gmail accounts; distinct shop D1 resources and verified bindings.
- [ ] Demonstrate denied cross-tenant reads, writes, impersonation, stale sessions and wrong resource binding.
- [ ] Execute fresh-shop product → purchase → POS sale → return, including multi-unit/Tiles, Cash Session, inventory FIFO and gross Party financial invariants.
- [ ] Simulate network interruption, duplicate button submit, exhausted quotas, failed migration and recovery; no half-enabled shop or duplicated identity.
- [ ] Export/restore a **non-sensitive test shop** into a second account and verify row count, identity, financial/stock parity and secrets/origin rotation.
- [ ] All reviewed CI/real D1/browser/security/release evidence is green. M10 and M11 remain independently approved decisions.

The release may say **"portable account installation ready"** only after this test is actually completed and recorded. Production-ready is a **separate** claim requiring M11 GO.

## 8. Coordination and ownership

- **Single shared-file owner:** M03 for \`src/db\`, \`src/index.js\`, \`src/rpc\`, migrations, Worker D1 bindings, \`wrangler*.jsonc\` and shared posting.
- **Security contracts:** M04 for Admin/Owner/staff auth; M11 for deployment/CI governance; M10 for private migration and restore; #690 for shop onboarding.
- **Current parallel rule:** [docs/PARALLEL_EXECUTION.md](../PARALLEL_EXECUTION.md); no competing edits to shared files, no simultaneous live financial writers.
- **Existing launch gate:** [M11 release-readiness matrix](../runbooks/M11_RELEASE_READINESS_MATRIX.md). This roadmap does not change its NO-GO status.
- **Tracking:** [PORT-00 #699](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/699), [#690](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/690), [#456](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/456), [#312](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/312), [#306](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/306).

**Immediate next engineering task:** P0 audit of instance-specific constants and a reviewed decision on shop-D1 provisioning/routing, then the P1 config validator on a scoped test-first PR. No remote changes or application behavior changes are authorized by this documentation.
