# M02-P — Offline Party approval evidence uniqueness and UTC review timestamp (2026-11-15)

## Context and authority
- Target `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/M03_PARALLEL_READINESS.md`, approved ADR-007.
- Original Mohim_ERP pinned SHA `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
- Existing `src/party/party-import-plan.js`: reviewed identity groups require nonempty `reviewedBy`, `reviewedAt`, `approvalRef`, but currently accept two unrelated links using the *same* approval reference and allow a timestamp like `now` or an impossible calendar date.
- PR #91's real-D1 readback adapter is merged, but D1 `party_legacy_links` still has no `approval_ref` column. That is **not** fixed or authorized here.

## Decision
Strengthen only the **offline, no-write source planner** with two deterministic fail-closed checks on each otherwise valid reviewed group:
1. `approvalRef` must be a nonempty, unpadded string and cannot appear in a prior distinct reviewed group. An approval reference authorizes one specific reviewed group; another unrelated group may not borrow it. Preserve exact case and spelling of IDs; never deduplicate on name/phone.
2. `reviewedAt` must be a real Gregorian UTC timestamp in `YYYY-MM-DDTHH:mm:ss[.SSS]Z` form (zero-padded, valid calendar day, no time-zone offsets). A future date is not rejected offline, since the planner lacks a trusted authoritative reviewer clock. An unpadded `reviewedBy` staff identifier is required; this is **not** authentication.

Existing `members` source-ID validation and overlap checks remain first, preserving more specific failures for malformed source links. The unique approval reference check must run before writing any Party grouping output. No ID rewriting, no name/phone matching and no automatic merging without the explicit approvedGroups input.

## Acceptance and RED→GREEN
- New `tests/contract/party-approval-evidence.test.mjs` covers distinct valid reviewed group refs, reused ref, padded ref, invalid `now`, impossible UTC date, offset timestamp, padded reviewer, stable output/input immutability, no account/netting side effects.
- Extend existing `tests/integration/m02-party-plan-workerd.spec.mjs` with a true local-D1 boundary assertion that a duplicated approval reference cannot produce synthetic SQL and does not alter D1 counts.
- Commit failing tests first and obtain GitHub Foundation and/or local D1 RED evidence; implement minimal planner validation; verify all CI including 84 pinned source files, real workerd/D1, Chromium and Cloudflare preview safety.
- Files: `src/party/party-import-plan.js`, two test files, this spec and plan. No migrations, `src/db`, RPC, Worker runtime, Cloudflare bindings, original UI or actual financial data.

## Limitations
This is an **offline evidence format/uniqueness check**, not proof that `reviewedBy` is a real logged-in staff actor, that `approvalRef` was actually granted, or that D1 persists it. M04 authorization and an owner-reviewed schema migration remain mandatory before production identity linking or posted-obligation migration. Source images/production data must not be logged. `PARALLEL-MODULE-READY` remains false.
