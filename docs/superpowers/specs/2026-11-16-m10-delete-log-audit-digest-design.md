# M10-06 — Source↔D1 DELETE_LOG immutable audit checksum

**Source:** pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Tracker:** #312. **Prerequisite:** merged M02 `DELETE_LOG` importer PR #344, distinct from ID-less `LOGS` M10-05 PR #354.

## Why this slice
The original `DELETE_LOG` has a stable `Log ID` unlike the separate `LOGS` diagnostics sheet. M02 preserved its nine columns, original physical row position, original `Log ID`, leading-zero mobile number strings, and append-only D1 triggers. We need a source-shaped checksum independent of the importer's postcommit compare, without treating legacy record/invoice/staff refs as linked foreign keys.

## Interface and behavior
Introduce one pure `summarizeM10DeleteLog({inventory,rows})` in `src/migration/m10-delete-log-digest.js`, returning **exactly** `{sheetKey:'DELETE_LOG',rowCount,rowDigest,idDigest}`, the M10-01 evidence shape. Use `verifyDeleteLogMapping` for exact nine frozen headers and `prepareSourceDeleteLog` for source row validation. Source inventory must be version 1 with exactly 49 unique well-named groups. No source or D1 access in helper.

Use M10-01's domain-separated canonical format `SHA256(JSON.stringify(['M10-ROW-v1','DELETE_LOG',[[physicalRow,log_id,date_text,time_text,module,record_id,invoice_no,reason,deleted_by,deleted_by_mobile],...]]))` for full row digest, and `SHA256(JSON.stringify(['M10-ID-v1','DELETE_LOG',[[physicalRow,log_id],...]]))` for original IDs. Hash values are only returned to trusted local caller, never logs or error messages. All invalid input throws fixed `M10 DELETE_LOG evidence invalid`.

Unit tests must assert immutable source, deterministic serialization independently, original IDs vs identical payloads, status/phone/whitespace preservation, missing row count, malformed source, symbol/accessor/extra field rejection and no leakage.

Isolated real Workerd/D1 integration uses existing `importSourceDeleteLogWithD1` and `wrangler.m02-delete-log-test.jsonc`. Read independently with fixed SELECT of versioned `legacy_delete_log` columns; project to source-shaped nine fields; calculate fresh source/target checksums and confirm equality. Prove actual D1 rejects UPDATE/DELETE via M02 immutable triggers, then demonstrate content-only/ID-only differences by independently altered *readback copies* rather than illicitly disabling audit triggers. Check replay denied and no HTTP/RPC route. No fake "SQL tamper succeeded" claims.

## Boundaries
Do not alter M02 SQL schemas, importers, source GAS, 49-group M10-01/03 gates, frontend, RPC, account relationships or production D1. No remote export or deploy. Existing immutable audit triggers must stay active. Test fixtures synthetic only, no private IDs/amounts logged. An M10 summary is **not** proof of an actual authorized two-pass source capture, financial ledger reconciliation, or owner go/no-go. M10-01 `authorizesImport:false` and `productionReady:false` unconditional.
Revert this PR to roll back.

## Alternatives considered
1. **Chosen:** separate pure M10 audit digest; avoids labeling audit history as a product catalog or touching shared M02 files.
2. Extend catalog helper to every table; rejected for premature generic abstraction.
3. Test through SQL UPDATE on audit history; rejected because it violates approved M02 immutability and would falsely simulate permitted correction.
