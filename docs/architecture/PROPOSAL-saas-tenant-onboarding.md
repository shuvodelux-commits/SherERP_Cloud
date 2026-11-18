# SherERP SaaS tenant onboarding pilot

Status: proposed for M03, M04 and M11 review. This change adds a local feasibility test. Live account enrollment, shop data access and remote provisioning require their own reviewed implementation.

## First business setup

- Bootstrap a single platform Super Admin through a one-time controlled operation using a verified Google identity and its stable issuer and subject. Persist authorization in Control D1. Apply the platform admin MFA release gate from the SaaS requirements before granting live authority.
- Use the existing native Google signature verification and nonce checks. The production platform session implementation must issue revocable opaque sessions and validate them against Control D1. Retain the 5 ms per-request CPU acceptance check on hosted Cloudflare with cold and warm requests.
- Let the Super Admin reserve an immutable shop ID, record the provisioning operation and choose an approved Owner recipient. Provision only the approved shop database, apply its migrations, verify its identity and record readiness before enabling membership or routing.
- Use a single-use, expiring Owner invitation bound to the shop and verified intended recipient. Consume it and create the Owner membership atomically in Control D1 with an auditable actor and operation ID. Replays cannot create another membership or grant platform roles.
- Derive shop access from a current server-validated session and active membership. Platform Super Admin authority governs provisioning. Access to a shop's ERP data requires an explicit shop membership.
- Privileged provisioning and migration credentials belong outside the tenant-facing Worker. The application starts with one codebase, one Control D1 and a separate D1 binding per shop. Protect against retries, stale configuration and wrong database mappings before turning on provisioning automation.

## Local feasibility evidence

`tests/integration/m03-tenant-binding-pilot-workerd.spec.mjs` runs a Worker with three freshly generated local-only D1 bindings. It models a minimal Control D1 with sessions, membership and tenant status and a sentinel row in each shop. It accepts a user with memberships in both shops, rejects cross-shop and unverified requests, denies implicit access for a synthetic platform identity, rejects expired and revoked sessions and stops on a mismatch between the selected shop and its stored marker. This tests marker mismatches and membership denial. It does not verify hosted database UUIDs or exercise platform RBAC. This read-only fixture has no deployments or business APIs.

Run with the pinned local Wrangler used by M03 CI:

```sh
node --test tests/integration/m03-tenant-binding-pilot-workerd.spec.mjs
```

Before opening the Owner flow, prove atomic invite acceptance and overlapping provisioning retries, test actual sessions with two nonproduction shops, rehearse backup and recovery, and measure binding changes and limits at the planned scale. Keep historical SQL import separate from account configuration and point the business import at the intended shop database only after reconciliation.
