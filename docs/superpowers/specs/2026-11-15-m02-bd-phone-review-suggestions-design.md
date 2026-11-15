# M02-P — Bangladesh local/international phone formats in Party review suggestions

**Authority:** `AGENTS.md`, M02-P in `docs/WORKSTREAMS.md`, owner-approved ADR-007, frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Root cause
`planPartyImport` produces `SHARED_PHONE` review suggestions using `normPhone`, currently stripping all non-digits but retaining the dialing prefix. The same Bangladeshi mobile number exported as `017XXXXXXXX` and `+88017XXXXXXXX` (or `88017XXXXXXXX`) yields two different match keys. The offline planner can therefore miss a potential ambiguous relationship that deserves **human review**. Identical names can still generate `SAME_NAME`, so tests must use different source names to detect this independently.

## Decision
Normalize phone digits to the legacy local `01XXXXXXXXX` key *only* when the stripped string exactly matches the standard 13-digit Bangladesh mobile `8801` followed by 9 digits. Existing local numbers stay unchanged. Do not normalize other country codes, arbitrary lengths, text, names, original IDs or stored contact values; the normalized value is solely an internal **candidate review index**.

No phone match is proof of legal identity, no automatic Party merges or role/account netting, no new approvals. When a reviewer explicitly supplies `approvedGroups` with valid separate evidence, only that existing approved path may link original master IDs.

## Acceptance
- `01700000000` vs `+8801700000000` with distinct names triggers `SHARED_PHONE`, never `SAME_NAME` or automatic linked Party.
- Bare `8801700000000`, and digit punctuation/whitespace around `+880`, also trigger review.
- Different mobile numbers and a different country code do not create false shared-phone matches; no short/invalid number rewriting.
- Source phone cell values, literal IDs, party kinds, financial roles and input objects remain unchanged.
- Explicit human-reviewed group still uses existing evidence path, with no implicit phone authorization.
- Test first GitHub RED then minimal GREEN; run full exact-head CI.

## Scope
`src/party/party-import-plan.js` one normalization expression, focused contract tests, this spec and plan. No original GAS/Sheets/HTML, D1/migration, `src/db/**`, RPC, Cloudflare config, auth, cash, bank, stock, finance, or production posting. No change to Party IDs. No real customer data. `PARALLEL-MODULE-READY=false`.
