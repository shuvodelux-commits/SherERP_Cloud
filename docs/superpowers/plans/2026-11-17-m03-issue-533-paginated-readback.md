# M03 — Fix #533: Bounded Whole-Group Source Archive Readback Pagination

**Base:** `main@319ea3ef688af60069036eb5d67b4d56d52dd2a2`, frozen Mohim_ERP source `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; **owner:** M03 #22, high issue #533; **coordination:** #456; **M11-owned CI issue:** #532.
**Owned code:** existing `src/db/m03-frozen-source-readback.js` and `tests/m03-frozen-source-readback.test.mjs`, `tests/integration/m03-frozen-source-readback-workerd.spec.mjs`, plus new M03-specific docs. Avoid live M03 #535 `src/db/canonical-product-source-read.js`, `tests/integration/m03-workerd-core.spec.mjs` and product tests; do not change any M11-owned `.github/workflows/**`.

## Thirteen-sentence implementation overview
1. Preserve the original source-shaped return contract of 49 frozen groups and 659 exact source columns.
2. Replace the arbitrary 1,000-row group cap with bounded **keyset pagination** over physical original `legacy_sheet_row` numbers.
3. Keep the source commit and group name strictly parameter-bound in fixed SQL; never concatenate user-controlled identifiers.
4. Make every page select source rows strictly after the last observed physical row, ordered ascending, with a hard fixed page size.
5. Require all returned row numbers to be safe integers at least two, unique and strictly increasing across page boundaries, preserving intentionally missing original sheet row numbers rather than renumbering them.
6. Reject fewer or extra rows relative to an independently sealed group count, including checking one additional page for undeclared extras after the count.
7. Validate the exact original text array, width and type of every source cell and the unmodified canonical M02 SHA-256 over each complete group.
8. Re-read the 49 archived seals after all pages and require the committed seal metadata to be unchanged, reducing undetected concurrent staging mutation.
9. Bound total rows, serialized UTF-8 bytes, single-cell JSON length, query page size and wall time to fail closed on unsafe workloads.
10. Do not return partially accumulated data if any page, seal, digest, resource check or D1 call fails.
11. Add RED tests for a correctly sealed 1,001- and 2,049-row group, exact-money/phone preservation, unexpected/missing/duplicated/out-of-order pages, and resource exhaustion.
12. Keep all errors fixed and redacted, with no log, public RPC, production D1 migration, private data export, financial posting or user-facing endpoint.
13. Use Superpowers RED→GREEN with hosted GitHub tests and full exact-head CI, then hand off required actual Workerd/D1 execution to M11 under #532 before claiming its runtime coverage.

## Resource budget / acceptance
- Fixed page size: **256** rows; maximum private archive **250,000** rows total (including all groups), **8 MiB** combined serialized source-rows UTF-8 evidence, **20 seconds** elapsed, fixed secret-free error message.
- Original logical source IDs/text are untouched; original physical sheet row gaps remain valid.
- The reader continues to return an internal synthetic/staging candidate shape, *not* signed approval or any real production D1 parity.
- Real D1 archive migration and source data export are separate M03/M10 owner gates; the reader remains internal/test-only, with `productionReady:false`, `authorizesImport:false`, `publicRpcEnabled:false`.
