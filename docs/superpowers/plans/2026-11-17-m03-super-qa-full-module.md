# M03 Full Module Super Board-style Super QA — evidence-only plan

**Source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` • **GitHub base main:** `f3c1567a66d4e9df98dc1e8de211bd26c12871b2` • **Workstream:** M03 issue #22 • **coordination:** #456.
**Independent active PR:** #528 owns `src/rpc/awaited-response-boundary.js` and `src/rpc/handler.js`; do not change any of its claimed paths or tests.
**M03 QA-owned files:** new `docs/reviews/2026-11-17-m03-super-qa-full-module.md` and *QA-only* test additions to `tests/m03-frozen-source-readback.test.mjs`, no production files or shared workflow changes.

## Twelve-sentence QA overview
1. Use the Super Board `super-qa` acceptance-ledger, test-gap, adversarial-safety and evidence handoff method for the full M03 integration scope.
2. Evaluate code on the exact GitHub `main` SHA and each separate active M03 PR head, without implying unmerged code exists on `main`.
3. Map each core M03 acceptance criterion to an actual Node/SQLite, local Workerd/D1 or end-to-end test assertion, explicitly marking uncovered criteria.
4. Verify the frozen 49 source groups, 659 original column headers, source identity/Party provenance and no name/phone automatic linking.
5. Audit awaited repository and strict RPC response serialization for nested promises, malformed output, duplicate keys, accessor invocation and exposure risks.
6. Inspect D1 transactional atomicity, source-ID and receipt proofs for same-transaction authority, replay, reversal, cash-session and distinct gross Party account coverage.
7. Confirm that public Worker RPC stays blocked before M04 trust integration and private source archive values never become preview responses.
8. Distinguish synthetic local D1 proof from actual owner-approved and independently reconciled business-data import.
9. Write targeted QA regression tests for a correctly sealed 1,001-row archive group that current bounded readback rejects.
10. Write adversarial tests for extra D1 columns and dangerous getters, requiring fail-closed redacted errors without executing the accessor.
11. File traceable release-blocking findings to the actual M03/M11 integration owners, leaving overlapping implementation code untouched.
12. Run fresh full exact-head CI on a QA-only PR and issue a `FAIL / blocked for production` verdict until all security, data-integrity and source-to-D1 migration gates have evidence.

## Execution / release safety
- No original GAS/Sheets data access, remote D1 reads/writes, public RPC activation, production or Cloudflare deployment, Cloudflare credentials, shared `migrations/**`, `src/db/**`, `src/rpc/**`, `src/index.js`, or `.github/workflows/**` modifications.
- Preserve the single M03 integrator and M11 shared CI owner. The QA lane **does not fix app code** when a high gap needs integration code: it produces a reproducible test and issue for the builder.
- This independent QA test-only PR may merge after exact-head full CI and required review, but **M03 module / production release stays NO-GO** until M03/M04/M05–M08/M10/M11 explicitly approve the outstanding gates.
