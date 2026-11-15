# M02-P — Duplicate Source Identity With Blank Name: Design

**Authority:** `AGENTS.md`, `docs/WORKSTREAMS.md` (M02-P2), ADR-007, frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Defect and intended behavior
The offline `planPartyImport(sourceRows,approvedGroups)` currently tracks duplicate `(sourceGroup,sourceId)` keys only after excluding rows with missing display names. A named row and an unnamed row sharing the same original ID therefore can incorrectly produce an active proposed Party/link for that duplicated ID.

Every nonblank original source ID must participate in duplicate detection **before** the display-name completeness check. If an ID repeats within the same source group, quarantine **all** copies, emit exactly one deterministic `DUPLICATE_ID` OPEN review, and propose no Party, role, or legacy link for that key. A single unique ID with a blank name retains the existing `OTHER` review. Equal ID strings in different source groups remain independent identities.

## Scope and exclusions
Modify only the existing pure offline Party planner, add focused Node regression tests, and this specification/plan. No change to reviewed human-evidence contracts, original source, D1 schema, import writes, RPC, staff auth, Worker preview, financial posting or production data. Preserve source row numbers, redacted downstream reports, deterministic output, and untouched unrelated identities.

## Acceptance
1. Named + blank-name duplicate same source ID quarantines both, yields one `DUPLICATE_ID` review, no link for ID.
2. Two blank-name copies of the same original ID yield one `DUPLICATE_ID` review, not duplicate `OTHER` reviews or a thrown review-ID collision.
3. One unique blank-name ID remains quarantined as `OTHER`.
4. Same literal ID in two distinct source groups must not trigger a duplicate-ID quarantine; existing separate-Party and identity-review logic stays intact.
5. GitHub Actions shows test-first RED, minimal GREEN and full affected suite/CI. `PARALLEL-MODULE-READY` remains false.
