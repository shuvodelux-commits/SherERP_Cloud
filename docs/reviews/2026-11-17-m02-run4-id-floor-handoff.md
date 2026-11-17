# M02 Run 4 — Original Source ID Floors and Reconciliation Handoff

**Module:** M02 issue #24, coordination #456. **Source pin:** Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2. **Status:** offline, nondeployable engineering only. **No live source rows or DocumentProperties were accessed**; source-to-D1 reconciliation remains **0/49 verified**.

## Source-derived rules that must survive migration

The original Config.gs defines 38 sequential families with a minimum six-digit pad. The original Utils.gs generateId_ starts at the document property named `ID_COUNTER_<GROUP>`, checks the actual first-column historical IDs under the source caller-held script lock, advances from the higher numeric value, persists the counter and returns a prefixed ID. The counter is NOT derived from row count, active rows, customer names or the next SQL rowid. A deleted or cancelled historical record can have reserved a higher ID; the original document property may exceed the surviving sheet maximum and must not be lowered. The original permissive parseInt can also over-accept manually altered suffixes; this offline contract quarantines such IDs and forbids silently guessing the original allocation. The original source remains untouched.

| Original family | Historical source ID | Original prefix | Source function |
| --- | --- | --- | --- |
| SALES | Invoice ID | INV | Sales.gs completeSale; reserve before split-payment journal |
| PURCHASES | Purchase ID | PUR | Purchase.gs completePurchase |
| SALES_RETURN | Return ID | SRT | SalesReturn.gs completeReturn / child in completeReturnBatch |
| PURCHASE_RETURN | Return ID | PRT | PurchaseReturn.gs completePurchaseReturn |
| Other 34 config families | Frozen first Config.HEADERS column | Config.ID_PREFIX | generateId_ caller-held script lock |

An `SRB-<same numeric suffix>` batch label is derived from the **first existing SRT ID**; it is not a separate counter family. Historical SALE_POSTING_JOURNAL operation IDs, SESSIONS random session tokens and SETTINGS keys are **not** sequential families and must never be rewritten or inferred as such. The 8 source groups with repeated parent/line IDs or no natural ID rely on original physical sheet-row provenance; see M02 Run 1–3.

## Offline input and CLI contract

The caller provides **one existing private JSON file outside GitHub and outside a public Worker preview** with exactly these keys:

- `formatVersion:1`
- `sourceCommit`: the pinned 40-character source commit above.
- `groups`: exactly the 38 Config-derived family names. Each family contains an array of `{sheetRow, id}` extracted from the original ID column, including deleted and historical rows. Row positions are 1-based original Sheets physical rows; row 1 is the header.
- `counters`: exactly those 38 family names, each with a separately captured original DocumentProperties decimal string (`"0"`, `"4"`, etc). `null` means evidence was not captured and **blocks** the candidate; missing, numeric, noncanonical or unsafe values also block it.
- `declaredSourceCounts`: exactly those same families with separately declared original row counts. A different number of included ID rows is a blocker.

An empty source family still requires an explicit empty `groups[family]`, a separately declared count `0` and an actual captured counter. Do **not** fill an unavailable private counter with a guessed zero. Capture no passwords, names, phone numbers, amounts, tokens, full Settings or live source records beyond the minimum necessary ID-column evidence. The M02 safe reader rejects URLs, final-path symlinks, FIFO/device/directory inputs and >64 MiB files; files stay local to the operator.

Example invocation after authorized private capture:

    node scripts/dry-run-id-floor.mjs /private/authorized/original-id-evidence.json

The CLI emits **only** each issue's public source-group name, fixed issue code, issue count and unconditional NO-GO flags. It never prints actual original IDs, candidate next IDs, counter floors, source file paths, property values or raw rows. Exit 0 means the supplied **offline candidate** was internally consistent; exit 2 means evidence was invalid or not candidate-ready. Exit 0 does **not** mean source authorization, remote D1 readback, ID issuance, posting readiness or a production cutover.

The reusable pure function `buildM02IdFloorReview` returns an internal-only per-family candidate (maximum historical sequence, source counter, proposed next ID) for a separately authorized M03 reviewer. This is a **proposal**, not a lock, CAS, authoritative allocation or real D1 writer. It must not be surfaced in logs, PRs, CI snapshots, public RPC or previews when based on actual records.

## Fail-closed cases

- Missing group/counter/count evidence, source pin/schema drift, unknown group or unbounded input: reject evidence.
- Duplicate/reused original ID, duplicate/nonpositive physical row number, malformed prefix, extra leading zeroes, nondecimal suffix, whitespace-altered alias, zero ID or overflow: quarantine original row for human review and make this family not a candidate.
- Inaccurate independently declared counts: block the family. Comparison uses included **row identities**, never the current row count as a sequence maximum.
- A property ahead of surviving historical rows remains the floor. A stale property lower than historical maximum is safely overtaken by the historical maximum. Neither case proves historical reserved gaps, deleted copies or unrelated operation IDs.
- High floor at Number.MAX_SAFE_INTEGER: stop allocation rather than wrapping or rounding.
- A collision or source ambiguity is not repaired by renumbering any original document, merging Party identities by names/phones, dropping soft deletes, creating a new counter prefix or auto-netting gross accounts.

## Integration handshake: responsibilities and remaining evidence

**M02 #24:** delivers Config-pinned 38-family mapping, original ID/physical row/counter preservation contract, deterministic synthetic tests and offline redacted issue codes. This handoff is a narrow addition to the previously merged **49 source-group proposals and 659 field obligations**. M02 does not upgrade any of the 30 uncovered source groups or 19 partial-only groups to fully imported status.

**M03 #22:** reviews this contract before reserving SQL IDs. Provide tenant-scoped original ID uniqueness (including deleted history), stored counter-floor provenance, SQL-level atomic compare/update/insert in the *same* durable transaction as any post, safe concurrency and repeat/replay/rollback tests in **actual local Workerd+D1**. Review original source-ID floors for SALES, PURCHASES, SALES_RETURN, PURCHASE_RETURN and 34 other generated families separately. The source's script lock does not substitute for a D1 transaction. Never use SQLite AUTOINCREMENT/row count as a direct replacement for source ID issuance. No parallel second writer, shared D1 SQL edits or public RPC from this M02 PR.

**M04 #23:** session/tenant/actor permission proof must be inside the real D1 mutation. No client-supplied authority or account-role masquerading as staff permission.

**M05–M08:** preserve original invoice/purchase/return foreign references, FIFO stock lots, Tiles Box/Pcs/Sqft, native corrections, Cash Session and exactly-once reversing operations; all gross Party account kinds remain separately signed, reconciled and non-netted.

**M10 #312:** after written owner permission, independently freeze **all 49 source groups**, privately capture original source counts/ID digests plus DocumentProperties and the M03 D1 readback, then reconcile every original source ID and physical row, gross Party account totals, money/date textual precision, references, audit histories and internal D1 import/replay/rollback evidence. A self-copy of a source export is NOT independent D1 reconciliation. Preserve private evidence outside GitHub and previews. Any mismatch, unresolved identity or missing D1 approval yields NO-GO.

**M11 #306:** separately authorize private source access, backup/restore rehearsal, SQL migration, staging/production bindings and cutover with a written go/no-go. No approval is implied here.

## TDD evidence and acceptance

- RED test-first commit `d8b96416deec49bb661ebad3b3f8fce2ec05124f` (before the new implementation), actual Cloudflare PR-safety job failure `134061428076` in workflow run `44089738144`: expected `ERR_MODULE_NOT_FOUND` for the new test import. The same missing-module failure is confirmed in the M02 staging-local job `134061429524` / run `44089738224`. That Foundation job reported 3,301 passes and 1 expected failing test file; no false claim of a code-level assertion RED.
- GREEN implementation first commit `ae01c0beeff018bf8d75b6950cdd7c803dd03fe9`.
- **Exact-head full GitHub CI, final review and merge status must be recorded only after completion**, not assumed from synthetic Node tests. This paragraph is deliberately not an approval mark.

## Rollback and post-merge

If this offline contract is rejected, revert the isolated M02 PR. No schema, posting engine, original GAS source, Sheets, cloud D1, cash/bank or customer data has been touched. After all exact-head checks and required review are green, merge the M02-owned PR to **main** and verify the added script/tests/docs exist on main. Then M03 integration and M10 private reconciliation remain independent, separate approval gates.
