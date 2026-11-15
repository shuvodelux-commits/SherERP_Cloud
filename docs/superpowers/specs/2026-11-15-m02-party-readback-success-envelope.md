# M02-safe — Fail-closed Party identity D1 readback result envelopes

**Status:** approved architectural constraint implemented as a narrow test-first validation patch; no import writer, approval authorization, production schema or migration.

## Provenance and purpose

Original source pinned at `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; `AGENTS.md`, `docs/WORKSTREAMS.md` and ADR-007 govern Party account isolation and explicit human reviews. Prior merged PRs #86/#91/#102 created an offline Party import reconciliation helper, read-only D1 three-table batch adapter and canonical human approval evidence preflight.

The current `src/party/d1-identity-readback.js` currently rejects `success===false` but accepts a batch entry with missing/null/zero/text-valued `success` if `results` contains a matching array. This can promote a malformed D1 response into a plausible Party identity parity result. D1's documented shape for a successful `DB.batch` entry is a result containing `success:true` and a `results` array. Require the literal boolean `true` on **every** of exactly three prepared SELECT results. Fail closed for missing/false/null/0/1/string-success entries, rejected DB batch, invalid list shape. Continue to return fixed generic `Party D1 identity readback unavailable` without leaking raw SQL, customer names, phones, IDs or error payloads.

## Non-goals and architecture

Do **not** read the individual D1 tables in separate transactions, retry financial writes, add CRUD/RPC routes, or alter Party schema `migrations/0002_party_identity.sql`. `approval_ref` remains deliberately absent until reviewed migration and M04 authenticated approval flow. Do not mark a human-verified link reconciled, auto-merge identities by phone/name, or change account/card/cash/bank/ledger imports. This patch is one condition change and a narrow real-Workerd validation regression. `PARALLEL-MODULE-READY=false`.
