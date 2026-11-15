# M02-safe: Party review queue D1 result-envelope and count integrity

**Source:** pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `AGENTS.md`, ADR-007. **Owner:** independent M02-safe read-only Party validation.

## Problem
`src/party/d1-review-queue-summary.js` performs a prepared SELECT to count open human-identity review reasons. It currently accepts responses with absent or non-boolean `success` flags whenever an array of results is returned. A malformed D1 response may be treated as authoritative, understating the pending identity-review backlog. Additionally, SQL `GROUP BY reason` with `COUNT(*)` cannot produce `count:0`, yet the adapter allows this impossible count, potentially falsely implying that the reason was cleared.

## Design
Require literal `result.success===true` and a `result.results` array; fail closed on false/missing/undefined/null/numeric/string statuses. Reject any `count<=0`, noninteger/unsafe totals, duplicates or unexpected reason; preserve deterministic sorted `{totalOpen,byReason}`, exact reason vocabulary and redacted generic errors. A legitimate empty D1 result remains `{totalOpen:0,byReason:[]}`. Test against *actual local Workerd/D1 prepared SELECT results*, deliberately wrapping the D1 response to inject invalid result envelopes or zero counts. Verify no Party/role/link/review rows are modified, no identifiers/phone/name appear in output and no public RPC is added. Never infer human approval from counts.

## Exclusions
No `src/db/**`, `migrations/**`, shared M03 kernel or M04 authorization; no import, reviewer approval, live D1 credentials, money or Party identities changed. `approval_ref` persistence and authenticated review remain separate blockers, `PARALLEL-MODULE-READY=false`.
