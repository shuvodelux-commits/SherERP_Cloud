# Superpowers M04 — Private staging staff-import operator (2026-11-18)

**Workstream:** M04 #23; integrator M03 #22; M11 #306 recovery; central #456.  
**Base:** `main@c5f282c92c39b56d5ecf12b78a3143f4623576a9`.  
**Source:** frozen Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.  
**Scope:** M04-owned private transport, local synthetic config, focused tests, one nondeploying preparation script, M04 workflow test inclusion (requires M11 CI review) and operator runbook.  
**Not in scope:** shared `src/db/**`, `migrations/**`, `src/rpc/**`, `src/index.js`, root/public Worker binding, real staff import, any other D1 writes or production cutover.

## Implementation overview (12 sentences)

1. The owner-approved staging auth-only schema already contains migrations 0001–0004 and no imported staff.
2. A private Workerd/D1 rehearsal has successfully imported two valid historical staff, leaving the original Active Owner outside the D1 enrollment.
3. The reviewed source importer already enforces an atomic batch, exact IDs and role/source provenance.
4. We must reuse that importer rather than introduce another D1 staff mutation engine.
5. The new operator Worker will remain disconnected from the public ERP entry point and RPC registry.
6. It will accept a single loopback-only, secret-authorized request and refuse untrusted HTTP origins, cookies, methods and routes.
7. It will accept only two complete source captures and delegate their validation to the existing Administrator-first helper.
8. It will emit only safe aggregate counts and fixed status responses, never identities, SQL, credentials or bearer tokens.
9. A separate Node preparation script will create an isolated temporary Wrangler configuration with exactly one private staging D1 binding.
10. The configuration will use a random one-time token stored in a mode-0600 file outside the repository.
11. Tests must prove access denial, malformed-source zero writes, successful exactly-once import, Owner preservation, replay failure and config hygiene in real local Workerd/D1.
12. A human-reviewed M03/M04/M11 operator, provenance and recovery gate will still be required before remote staff import or authenticated UI activation.

## RED → GREEN evidence

- RED #1: `tests/integration/m04-private-import-operator-workerd.spec.mjs` failed because the Worker entry point did not yet exist.
- GREEN #1: minimal `src/auth/m04-private-import-operator.js`; 3/3 isolated real Workerd/D1 tests pass.
- RED #2: `tests/m04-private-staging-operator-bundle.test.mjs` failed with `ERR_MODULE_NOT_FOUND`.
- GREEN #2: `scripts/prepare-m04-private-staging-operator.mjs`; 2/2 tests pass.
- Combined focused green: **5/5**; full exact-head CI and independent review pending.
- Future acceptance: current-head M04 real Workerd suite and standard GitHub required checks; no public worker route; review source timestamp attestation and fresh backup/bookmark before any real staging import.

## Safety / merge sequence

The M04 branch should merge only after current-head CI and independent M04 security, M03 D1 integrator and M11 recovery review. If root public Worker or shared migrations change, stop. A merged PR remains **operator candidate code**, not permission to run against real staff. Any actual remote import must be separately recorded with fresh evidence and staff confidentiality. Revert only these M04-owned helper/config/docs files if rejected; no deployed changes or source history mutation are expected.
