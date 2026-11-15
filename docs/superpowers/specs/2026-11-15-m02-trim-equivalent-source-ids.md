# M02-safe — Flag trim-equivalent legacy Party IDs as ambiguous

**Pinned source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Authority:** `AGENTS.md`, `docs/MIGRATION_PLAN.md`, ADR-007. **Owner:** M02-safe pure offline import planner.

## Problem
The current planner's `byKey` duplicate detector uses exact serialized `[group, sourceId]` keys. Within one legacy group, two distinct rows with source IDs `CUS-001` and ` CUS-001 ` are accepted as independent Party identities. This bypasses duplicate source ID review even though whitespace is not reliable human identity evidence. Do not silently trim and merge such records, nor rewrite source IDs.

## Decision and acceptance
Bucket source IDs by `[sourceGroup, rawSourceId.trim()]` **only to identify ambiguous duplicates**. Retain all original raw `sourceId` strings for Parties, rows, plans and eventual D1 links. When two or more rows share a collision bucket, quarantine **every** member (including the unpadded one); create exactly one deterministic `DUPLICATE_ID` review record for the bucket, and refuse any human-approved group referencing those quarantined members. A distinct source group with an identical ID string is not a duplicate; provenance keys always contain the source group. An isolated source ID with legitimate surrounding whitespace remains unchanged (no unilateral normalization or identity policy change). Case differences remain distinct, since no source-authorized case-folding policy exists.

An original missing name with trim-colliding source ID must not escape duplicate quarantine or produce a second conflicting `OTHER` review item. `_rowIndex` retains original safe integer/null semantics. Same-name and same-phone candidates remain suggestions only.

## Boundaries
No edits to D1 schemas, migrations, `src/db`, M03 posting, M04 reviewer authorization, account balances, cash/ledger, original GAS/HTML, or Cloudflare public routes. One pure planner change plus standalone Node contract and existing actual Workerd/D1 synthetic preflight test. Existing `approval_ref` D1 persistence and authorized review remain separate release blockers; `PARALLEL-MODULE-READY=false`.
