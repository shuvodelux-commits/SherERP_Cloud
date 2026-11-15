# M02-P post-import identity readback verifier plan

**Source SHA:** `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Single file owner:** `src/party/import-readback-reconciliation.js` and `tests/m02-party-import-readback.test.mjs`. No shared SQL/auth/deployment changes.

1. **RED:** Add focused test coverage importing `reconcilePartyImportReadback`; use the existing deterministic original-shaped `party-import.synthetic.json` and approved reviewed-group fixture. Commit and capture a failing test run before implementation.
2. **GREEN:** Implement one pure no-write verifier. Match by source stable IDs (never phone/name); compare fixed fields; reject extra/missing/duplicate rows, changed source rows/status/roles, review pending/quarantine and absent approved link reference. Return only redacted reason codes.
3. **Refactor/verification:** Check deterministic ordering and no input mutation; test both ideal future readback and the **actual current-schema approvalRef gap**. Run targeted tests, full `npm test`, `npm run verify:source`, `npm run build:frontend`, and GitHub CI.
4. **PR:** Document source SHA, exact two new code/test paths plus this plan/spec, no SQL/RPC/stock/financial side effects, limitations and next owner-reviewed D1 migration/auth gate. Never mark parallel-module ready.
