# M02-safe Superpowers — independent source-freeze evidence and secure local input (2026-11-17)

**Issue:** #24; **central coordination:** #456. **Base:** `SherERP_Cloud/main@7c81dca09f975fbda37586eb50c2763c7f8506df`. **Pinned original:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Scope/ownership:** M02-only `scripts/dry-run-source-freeze.mjs`, `scripts/dry-run-safe-input.mjs`, tests `tests/m02-source-freeze-import.test.mjs`, existing M02 `scripts/dry-run-source-parity.mjs` local-file safety call sites, and this document. No shared `src/db`, numbered `migrations`, public RPC, Workers configuration, D1 writers, PR policy, frontend files, or current source data.

## 12-sentence implementation overview
1. Keep the merged #493 source-to-source parity and reference-review logic as the authoritative all-49-group validation rather than rebuilding its source parser.
2. Create a deterministic offline evidence manifest that binds each frozen group to an explicit external row count and existing SHA-256 canonical text/physical-row digest.
3. Require **independently declared** counts for all 49 groups, including empty groups; never infer them as evidence from the same candidate export.
4. Reject missing, unexpected, negative, fractional and unsafe count values even if the source-shaped export otherwise looks complete.
5. Refuse to issue an exact-match manifest when an independently declared source count differs from the captured rows.
6. Verify subsequent source-shaped exports against the reviewed manifest without recomputing the baseline from the same candidate.
7. Preserve original IDs, phone text, signed debit/credit evidence, dates, Bengali strings, physical row numbers and deleted histories under the existing exact-byte digest.
8. Show only group names, counts, hashes and machine-safe discrepancy codes, never raw identifiers, balances, names, mobile numbers, Settings values or password material.
9. Report `d1Verified:false`, `sourceApproved:false` and `productionReady:false` regardless of a matching local rehearsal.
10. Require explicit regular local files for both new CLI modes and the older M02 parity CLI; reject symlinks, FIFOs, directories, oversize inputs, remote-like paths and malformed JSON.
11. Write tests first for valid capture/verification, count tampering, data drift, metadata spoofing, input hazards, deterministic replay and fixed-message rejection.
12. Make the smallest offline implementation, run affected/full GitHub CI and leave the PR unmerged until exact-head tests and reviewer approval.

## RED→GREEN acceptance and limits
- **RED first:** add `tests/m02-source-freeze-import.test.mjs` importing the absent helper `scripts/dry-run-source-freeze.mjs`; focused Node tests must fail for the missing implementation.
- **GREEN:** implement bounded local regular-file reader and offline capture/verify CLI without new dependencies or file writes; update the pre-existing M02 parity CLI to share the same secure read boundary.
- **Scope:** synthetic read-only proof, *not* independently signed human verification, real D1 reconciliation, source-data export, balance correctness, accounting posting, or go-live permission.
- **External declarations:** source sheet row counts must be supplied independently by an authorized observer; mismatches must remain visible to a reviewer. The tool cannot authenticate or prove that observer's authority.
- **Next step:** after an authorized source export is captured privately, M03/M10 can use this immutable count/digest contract for reviewed source-to-real-D1 comparison. No private files are committed to GitHub.
