# M10-07 — Immutable SALES_DRAFT_AUDIT source-to-D1 digest

**Source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Tracker:** #312. **Prerequisites:** reviewed merged M02 `SALES_DRAFT_AUDIT` archive and importer; M10-06 #365.

## Purpose
The original Draft Invoice Audit has exactly 11 headers: Audit ID, Timestamp, Action, Draft ID, Draft No, Version, Actor ID, Actor Name, Source Owner ID, Invoice ID, Note. Its authentic Audit ID must be reconciled independently from content and physical source row position. M02 importer already enforces immutable history, unique Audit IDs, enumerated actions, decimal-text Version, a bounded one-shot atomic D1 batch and postcommit readback. M10 must independently verify source and persisted D1 without inventing links or applying financial effects.

## Design and constraints
Introduce one pure `summarizeM10SalesDraftAudit({inventory,rows})` returning exactly `{sheetKey:'SALES_DRAFT_AUDIT',rowCount,rowDigest,idDigest}`. Reuse `verifySalesDraftAuditMapping` and `prepareSourceSalesDraftAudit` unmodified. Require `formatVersion===1`, exactly 49 valid/unique inventory groups and reviewed frozen 11 headers. Canonical row digest: SHA256(JSON.stringify(['M10-ROW-v1','SALES_DRAFT_AUDIT',[[legacy_sheet_row,audit_id,timestamp_text,action,draft_id,draft_no,version_text,actor_id,actor_name,source_owner_id,invoice_id,note],...]])); authentic original-ID digest: SHA256(JSON.stringify(['M10-ID-v1','SALES_DRAFT_AUDIT',[[legacy_sheet_row,audit_id],...]])).
Preserve original `Version` serialization **exactly** after M02 preparation: numeric 1 becomes '1', source string '02' stays '02'. Preserve source timestamps: strings unchanged, native Date normalized to ISO by M02; Note Unicode and whitespace intact. Never hash SQL internal `row_id` or collapse repeated draft IDs / duplicate draft numbers: each Audit ID is independent. Fixed redacted invalid error `M10 SALES_DRAFT_AUDIT evidence invalid`, no raw source rows/ID/hash bytes in CI diagnostics.

Create unit tests and real **isolated Workerd/D1** integration reusing existing M02 one-shot importer, local Wrangler config and fixed SELECT. Independent source and actually persisted readback digests must match. Verify immutable D1 UPDATE/DELETE rejects edits, replay fails, and altered *readback copies* independently change row versus authentic ID digests; shorter valid captures differ in count/hashes. Fixture returns 404 to HTTP requests. Add one PR-only M10 local D1 test step. No M02 schema/SQL/import edits or preview D1 binding changes.

### Alternatives
1. **Selected** separate tiny audit digest reusing M02 preflight, leaving reviewed M10 catalog and ID-less LOGS contracts alone.
2. Extend generic multi-group schema: rejected due immature 49-group review.
3. Change D1 triggers to demonstrate SQL tamper: rejected; immutable audit history is a requirement.

### Non-goals / blockers
No actual business export, D1 production import, public RPC, auth, Party/finance posting, sale draft editing, cutover. Existing M10-01 49-group gate and M10-03 two-pass source-freeze remain fail closed: `authorizesImport:false`, `productionReady:false` and incomplete real 49-group reconciliation. Revert this PR for rollback.
