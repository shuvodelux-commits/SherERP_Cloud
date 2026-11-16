# M10-10 — immutable OPENING_BALANCE_EDIT_LOG source-to-D1 audit digest

**Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Tracker:** #312. **Prerequisite:** reviewed, merged M02 original OPENING_BALANCE_EDIT_LOG schema, importer and isolated real Workerd/D1 tests.

## Why this specific next slice
The historical `OPENING_BALANCE_EDIT_LOG` holds original adjustments to opening balances and related due snapshots. Its 12 original source columns are: Audit ID, Changed At, Entity Type, Entity ID, Entity Name, Old Opening Balance, New Opening Balance, Delta, Current Due Before, Current Due After, Reason, Changed By. An edit event has a genuine original `Audit ID`; the combination of Entity Type/ID is only historical context and cannot be used to merge Customer and Supplier accounts. Signed numeric text including `-0.00`, whitespace, Unicode, date strings and ledger directions must be kept exactly as recorded, never recomputed or posted as new money.

## Design and contracts
Implement pure `summarizeM10OpeningBalanceEditAudit({inventory,rows})` returning exactly `{sheetKey:'OPENING_BALANCE_EDIT_LOG',rowCount,rowDigest,idDigest}`. Validate pinned inventory `formatVersion===1` with exactly 49 unique reviewed-format source-group keys and exact opening-balance source headers using existing `verifyOpeningBalanceEditAuditMapping`. Apply existing frozen M02 `prepareSourceOpeningBalanceEditAudit`: original physical-row continuity, unique genuine Audit IDs, exact non-accessor fields, native Date ISO serialization and bounded finite source-number-to-text conversion. Neither this helper nor its tests write to source GAS/Sheets or the production Worker/D1.

Canonical digest format:
- `rowDigest = sha256(JSON.stringify(['M10-ROW-v1','OPENING_BALANCE_EDIT_LOG',[[legacy_sheet_row,audit_id,changed_at_text,entity_type,entity_id,entity_name,old_opening_balance_text,new_opening_balance_text,delta_text,current_due_before_text,current_due_after_text,reason,changed_by],...]]))`
- `idDigest = sha256(JSON.stringify(['M10-ID-v1','OPENING_BALANCE_EDIT_LOG',[[legacy_sheet_row,audit_id],...]]))`.

No hash or raw source value leaves the helper via logs/errors; errors collapse to `M10 OPENING_BALANCE_EDIT_LOG evidence invalid`. The digest can be compared in trusted memory but is not cryptographic proof of source capture authenticity. Unit tests independently specify expected digest, test unchanged source, reordered JSON properties, original numeric and negative-zero-string semantics, whitespace/Unicode, dates, duplicate/gap/getter/symbol rejection, source count truncation, ID-only versus content drift, and inventory drift. A real **isolated Workerd/D1** test reuses merged M02 one-shot importer with synthetic rows, then queries fixed SQL SELECT independently and compares source and actual persisted digest values; checks immutable UPDATE/DELETE triggers, replay refusal, no HTTP import route and tamper detection via readback **copies** only.

## Alternatives rejected
1. **Chosen:** one narrowly scoped, source-backed immutable audit checksum helper and isolated D1 proof, no SQL/schema modifications.
2. Include opening balance deltas as financial postings or recalculate due: rejected because frozen history records a source event rather than a new transaction and risks double-posting or netting unrelated Party roles.
3. Generalize all 49 groups now: rejected because most are not yet fully reviewed and original-ID/positional provenance differs by group.

## Safety, release and rollback
No live business import, source writer freeze, Party cross-role offset, synthetic cash session, Cash/Bank posting, frontend/RPC, new Worker route, public/production D1, M02 mapping/schema changes or M10-01/03 weakening. Do not modify the previously merged M10-09 six-group reviewer in this PR: its reviewed-group count remains a versioned six-group proof, not a claim of comprehensive coverage. Full real-source 49-group migration still requires separate source captures, backup/restore, gross account parity and written cutover approval. `authorizesImport:false`, `productionReady:false` remain universal. Owner-reviewed revert of this PR is rollback.
