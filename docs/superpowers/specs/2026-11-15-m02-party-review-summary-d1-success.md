# M02-P — Identity Review Summary Explicit D1 Success

**Authority:** SherERP Cloud `AGENTS.md`, `docs/WORKSTREAMS.md` M02-P, approved ADR-007; frozen Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Defect
Internal read-only `summarizeOpenPartyIdentityReviews({DB})` accepts any `D1PreparedStatement.all()` result unless `success===false`. An envelope with missing, null or nonboolean `success` and plausible `results:[]` is therefore interpreted as **zero outstanding reviews**, despite absent proof of successful D1 execution. The same risk affects nonempty counts.

## Decision and acceptance
Require `success === true` before trusting any returned review rows. Absent, null, string, numeric and `false` statuses all reject with the existing sanitized `Party identity review summary unavailable` error, never with `{totalOpen:0}` or source identifiers. Preserve trusted `success:true` empty and populated counts, OPEN-only fixed prepared SQL, reason/count validation and sort order. No UI, RPC or public endpoint activation.

## Ownership, safety and rollback
Single existing `src/party/d1-review-queue-summary.js` conditional plus dedicated tests and these docs. Independent of concurrent #145 D1 **identity readback**, #146 **source snapshot**, #147 **approval evidence**; no edits to their files. No D1 schema or write, no auth, finance, Party automatic merge, account netting, production migration, original ERP, Workers config or new dependencies. Review and revert this PR for rollback.
