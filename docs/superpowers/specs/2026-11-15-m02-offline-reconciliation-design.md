# M02-safe Offline Import Reconciliation — Design (2026-11-15)

## Intent
Create a strict, repeatable *no-write* preflight gate before any M02 Party/catalog data import can be considered safe. This is an independent M02-safe QA lane permitted by `docs/M03_PARALLEL_READINESS.md`; it does not authorize Party ledger posting or transaction modules.

## Boundaries and source
- Frozen original source: `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
- Existing `prepareCatalogImport` and `planPartyImport` remain unchanged and authoritative for planning.
- No changes to `legacy/source`, `src/db`, migrations, `src/rpc`, `src/party`, Worker runtime, or existing deploy/CI configuration.
- No remote/local D1 writes, network calls, real customer exports, or printed PII.

## Alternatives
1. Reuse only existing dry-run row totals: minimal code but not sufficient to detect a dropped/rewired legacy ID, stale physical row or unreviewed merge in the *plan*.
2. Build the full M02 importer now: not permitted while M02-P and shared D1/atomic gates are open.
3. **Selected:** independently verify offline source-to-plan invariants with a fail-closed CLI and synthetic mutation tests. Release-neutral and testable now.

## Invariants
- Each approved catalog source group retains its row count, original ID and physical position in the generated plan, including Settings.
- Every Party legacy master record must have a stable nonempty original ID, a unique source-group/ID key and one preserved link with its available original physical row. Missing, duplicate or quarantined source rows fail the gate; these are not silently counted as imported.
- Different Party master rows remain distinct by default, even if name or phone matches; multi-source identity links are allowed *only* with matching explicit human-reviewed groups and retained evidence.
- Every original Party role, including combined Owner/Lender/Borrower, remains represented in the proposed role set.
- A named/phone candidate review is **not** an automatic merge and need not block an otherwise complete independent-identity plan.
- No accounts, settlements, cash/bank movements or aggregate net due are created. Only counts are emitted in success; errors redact all source values and input paths.

## Interface
`verifyM02OfflineReconciliation({catalogSource,partySource,catalogPlan,partyPlan,approvedGroups=[]})` is a pure function that returns sanitized counters or throws.
`node scripts/check-m02-offline.mjs <catalog-export.json> <party-export.json> [review-evidence.json]` loads only local JSON and the frozen schema inventory; exit 0 means the **offline plan** reconciles, not that any D1 import or accounting operation passed.

## Non-goals / release blockers
This QA gate does not validate live user exports, transaction-ledger balances, accounts by role, financial posting atomicity or real D1 import/reconciliation. M02-P account sign review and actual D1/CI staging tests remain separate required gates. Do not set `PARALLEL-MODULE-READY` from this evidence.