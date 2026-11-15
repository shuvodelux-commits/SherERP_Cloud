# M02-P: Exact Finance Person source-ID attribution in Party preflight

**2026-11-15. Workstream:** M02-P Party Import Validation. **Source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `FinanceModule.gs` and `OpeningBalance.gs`. **Policy:** `AGENTS.md` / ADR-007 unique source identity and independent finance-role accounts.

## Risk and decision

The existing source-only `prepareGrossPartyBalances` correctly links source masters by exact `(sourceGroup,sourceId)` through the offline planner, **but** trims `Finance Person ID` on finance transaction lookup and when building the source-specific finance role map. Thus the distinct original IDs `"FIN-001"` and `" FIN-001 "` collide. Transactions can be linked to a different source person or rejected against the wrong role; within reviewed Party groupings, source role leakage can occur despite the reviewed Party being only an identity group, not a license to borrow account authority.

**Decision:** Preserve the exact original `Person ID` string end-to-end for finance source role checks, transaction linkage, and account grouping. Only use `.trim()` to detect *blank/missing* IDs; do not normalize nonblank IDs. Unknown literal IDs (even when trimming would match or display name/phone matches) emit the existing `FINANCE_LEGACY_LINK_MISSING` blocker and no finance checkpoint. An exact ID that happens to contain spaces is retained literally and can match the same literal source master; the offline preflight must not guess whether a data-cleaning merge is authorized. Duplicate Finance IDs and nonactive/soft-deleted rows retain the original behavior. Existing source-role verification remains independent even if two master IDs are in one explicitly reviewed Party group.

Alternative of globally trimming all source master IDs or automatically aliasing transactions is rejected: it rewrites source identities, could merge distinct source records, and would conceal provenance problems. An entirely new SQL migration/importer is out of scope.

## Acceptance / regression coverage

1. An only-unpadded `FIN-001` source master must **not** absorb transaction Person ID `" FIN-001 "`; preflight reports existing missing-link blocker, omits any associated finance position, and stays not ready.
2. Two distinct masters `FIN-001` (Owner) and `" FIN-001 "` (Lender) keep separate source-role policies and exact ID-attributed owner-equity / lender-liability checkpoints. Their source IDs and Party IDs stay distinct by default.
3. If both records are explicitly grouped for offline review, their transaction role checks must still use their *own* source master: one master's Lender role must never authorize a Lender transaction on the other master's Owner-only Finance ID.
4. An exact padded `" FIN-001 "` literal master and transaction match without rewriting source ID. An unknown name/phone match never substitutes for an original ID.
5. No input mutation, no PII in newly generated logs, no D1 or RPC changes. Original Finance source files and pin stay unchanged.

## Work boundary / status

Pure existing `src/party/gross-balance-preflight.js` plus new `tests/m02-party-finance-exact-id-preflight.test.mjs`, this spec and small TDD plan. No new dependencies. **No** migration, `src/db`, public RPC, authorization, original frontend, remote/staging/prod D1, financial write, account netting or auto-linking. Synthetic Node parity tests do not prove real D1 financial reconciliation. `PARALLEL-MODULE-READY` is **not** set by this change; M08-S stays disabled. Revert the four-file PR if needed.
