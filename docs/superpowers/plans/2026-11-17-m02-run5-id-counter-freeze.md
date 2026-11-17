# M02 Run 5 — Super Build: private source ID + counter evidence freeze

**Issue:** #573, parent #24, coordination #456. **Base main:** `5a06c28a1a78ec1be9e3867797b0a80b01795901`. **Original source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Owner:** M02 offline import-semantic evidence only.

## Twelve-sentence implementation overview
1. Run 4 validated the original 38-family ID strings, physical Sheet positions and original DocumentProperties numeric counter text, but did not freeze a distinct later-verifiable source-specific identity proof.
2. Run 5 will add a standalone, pure, M02-owned commitment capture and comparison contract without changing Run 4.
3. The input is the exact Run 4 synthetic or independently authorized private original-ID evidence object.
4. The capture path must use the frozen original source pin and reject any Run 4 malformed ID, ambiguous counter, duplicate or count disagreement before producing a manifest.
5. Each manifest family will include row count and two salted, domain-separated SHA-256 commitments of the original `(sheetRow,id)` pairs and exact original property-counter text.
6. Original row identities will be sorted by `sheetRow` during hashing, so only original physical provenance rather than JSON list ordering determines identity.
7. The manifest root commitment will bind all family commitments and source pin, and corruption will be rejected before any comparison.
8. The `--capture` CLI will write a new private file exclusively with restrictive permissions, will never overwrite an existing destination and will not print ID/counter values or commitments.
9. The `--verify` CLI will use the existing bounded no-follow JSON reader and emit only fixed mismatch codes and counts, not sensitive evidence or paths.
10. Tests will first fail for the new missing module, then pass under the smallest implementation that covers correct replay, altered IDs, swapped row positions, changed counters, incorrect counts, corrupted manifests, confidentiality and CLI safety.
11. The work changes only a new M02 offline script, a synthetic M02 test file and M02-specific documentation; neither D1 migrations nor any Worker or posting path will change.
12. A successful offline source-identity comparison never proves independent capture, real D1 readback or source import, so M03, M10 and M11 approval gates remain explicitly blocked.

## Simplest-first / blast-radius decision
Reuse `buildM02IdFloorReview`, `M02_ID_FAMILIES` and `readLocalJsonFile` rather than creating a second ID parser, a second database adapter or a new dependency. Salted hash commitments are stored only in the caller's private manifest, **not** GitHub or CI output. This is *drift evidence*, not cryptographic authenticity or proof the two captures came from independent operators: a modified manifest without a separately anchored fingerprint is not tamper-proof.

## Acceptance and ownership
- Parent #24, task #573; no simultaneous edits to the shared M03 `src/db`, `migrations`, `src/rpc`, `src/index.js`, Worker config, CI workflows or financial kernel.
- Exact planned files: `scripts/dry-run-id-evidence-freeze.mjs`, `tests/m02-id-evidence-freeze.test.mjs`, this plan and `docs/reviews/2026-11-17-m02-run5-id-evidence-freeze-handoff.md`.
- RED acceptance test first; only test evidence from actual GitHub actions can establish RED.
- GREEN targeted Node and complete exact-head GitHub Actions required before QA handoff.
- Super Build **builder** exits with a **draft PR** for QA; it does not merge, set production GO or claim it moved GitHub Project cards without a configured project workflow.
- No real source snapshots, source IDs, original Google Sheets, current Cash/Bank/Party records or remote D1 access.
- Rollback: revert the standalone M02-only draft PR; no data/schema rollback.
