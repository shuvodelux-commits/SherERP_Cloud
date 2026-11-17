# M04 G1 authority integration acceptance — scoped handoff plan

**Status:** M04 contract/review preparation; NOT a green production security gate.
**Issues:** M04 #23 and #252; M03 #22; coordination #456.
**GitHub base:** `main@bcd2d3adbd03f35612c50c1a144a472b1683b412`.
**Source:** pinned Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Depends on merged PRs:** #261 (synthetic PCAT/PUNT actor-bound authorized claim), #421 (private login/shell), #436 (read-only staging evidence), #479 (offline array shape guard), #483 (M03 synthetic sale posting).
**File ownership:** M04 docs only: this plan and `docs/M04_G1_AUTHORITY_ACCEPTANCE.md`. M03 alone owns all shared SQL, `src/db`, `migrations`, `src/rpc`, `src/index.js`, posting and public integration.

## Owner-approved existing lane — 12-sentence design overview

1. M04 needs an explicit, versioned acceptance handoff before M03 can integrate real authenticated transactions.
2. The current login and permission implementation runs only in private or synthetic D1 contexts, not in the deployed public Worker.
3. Merged M03 PR #483 proves a narrow authorized stock-and-two-leg-journal transaction against local synthetic D1.
4. Those test-only tables do not prove the source-faithful POS, Cash Session, Party or FIFO financial engine.
5. The handoff must specify exact actor, session, role, credential and expiry predicates in the very SQL statement that commits each protected operation.
6. It must distinguish a trusted server clock and business context from client-supplied request fields.
7. It must keep 32-byte decoded-token SHA-256 fingerprints and never expose a reusable bearer or password verifier in receipts.
8. It must define immutable actor-owned intent hashing, safe replay, same-actor readback and outcome uncertainty.
9. It must explicitly test disabled accounts, stale role epochs, revoked and expired sessions, permission value types and SQL failure rollback.
10. Last-active-Administrator protections and source staff identity/provenance require a separate deployable M03 schema review.
11. The document must name exactly which future work belongs to M03, M04, M02 and the owner, without changing any deployed route or financial table.
12. Acceptance remains blocked until complete current-head real Workerd/D1, original UI E2E, protected staff export/import and release approvals exist.

## Execution

1. Read current coordination rules, M03 G1 handoff, M04 auth source contract, merged implementation and Workerd tests (done against listed main SHA).
2. Write `docs/M04_G1_AUTHORITY_ACCEPTANCE.md` with a precise authority predicate, interface sketch, negative-test matrix, evidence sources, open decisions and ordered gates.
3. Documentation-only change: no artificial RED. Audit cross-references and run the repository's full PR CI, including source manifest, Node, original UI Playwright, M04 real local Workerd/D1 and M03 tests. Do not claim any unexecuted test green.
4. Open one independent docs-only M04 PR against main, register handoff on #23/#252 and request M03 review via #22; no source, fixture, workflow or runtime modification.
5. Do not merge without exact-head complete CI and required reviewers. If main advances without touching these paths, avoid needless rebases; verify ancestry just before merging.
6. Owner-approved staging staff snapshot, private Worker, auth-schema migration, real source-ID/Party accounting import, and public API cutover are **not authorized by this PR**.
