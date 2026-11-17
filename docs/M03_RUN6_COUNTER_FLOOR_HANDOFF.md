# M03 Run 6 — private fresh-tenant original ID counter-floor audit

**Source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Workstream:** M03 sole owner #22; board #456. **Required prior review:** M02 Run 5/6 historical counter evidence and M03 Run 5 source/archive comparison (merged PR #600).

## Narrow audited contract

`createM03PrivateSourceFloorAudit({DB}, trustedTenantId).auditFreshSeed_({idEvidence,freezeManifest})` accepts only a trusted internal tenant scope and the strict M02 historical-ID/frozen DocumentProperties evidence. Before reading any counter, it invokes M03 Run 5's source reconciliation, which performs the complete **49 source-group sealed, exact-text, whole-group SHA-256 D1 readback** and verifies the **38 original generated-ID family physical rows and salted ID/counter freeze**. The audit then queries exactly 38 synthetic counter rows for the trusted tenant, checks Config-pinned prefixes and each exact `current_sequence === max(original DocumentProperties counter, highest historical/deleted ID sequence)`. Missing, extra, duplicate, incorrect, unsafe or cross-tenant counters fail. It also requires **zero previously issued receipts** for that tenant.

Read-only fixed SQL and bound tenant values only. No schema migration, seed/update, allocation, signing, live money posting, session authority, public RPC or D1 binding is created. The source authority and the DB may change concurrently after a passed inspection; this is **not** a durable issuance authorization or a transaction lock. The result carries `idIssuanceAuthorized:false`, `sourceToD1Reconciled:false`, `publicRpcEnabled:false`, `productionReady:false`. Do not use it as production readiness proof.

## Test evidence and acceptance

- **RED** on GitHub test-first head `127256d4e7c4605621e296b2b08041c201bce619`: Foundation workflow `44130363876`, job `134205431000`, expected missing `src/db/m03-private-source-floor-audit.js`: 3,417 Node passes, one expected failing Node test file.
- **GREEN (mandatory):** same-head Node SQLite tests including 38-family equality, changed historical floors, incorrect D1 prefix, missing/extra family, zero prior receipt and cross-tenant denial.
- **Real D1 (mandatory):** extend the final case in the already-sharded `tests/integration/m03-frozen-source-readback-workerd.spec.mjs`. Keep M11's expected five-case suite count unchanged.
- **Full CI + reviewer:** all required GitHub workflows on the exact PR head, independent Super QA and Super Review before human-approved merge. No M11 shared CI-path changes.

## Unchanged blockers

Actual owner-authorized original Sheets and DocumentProperties capture; independently reconciled 49/49 business data in operational D1; reviewed per-tenant safe original ID floor installation; M04 live staff sessions/current SQL authority; M05–M08 source-faithful POS/Purchase/Return/Cash/Bank/Party atomic kernel and replay/reversal; M10/M11 private staging, backup/restore and owner cutover approval. The public `src/rpc/registry.js` remains intentionally fail closed.
