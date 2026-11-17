# M02 #602 — private actionable original-row review queue

**Base main:** `5290a06abda5a0e42192b8bfbcc2f83e59495647`; **frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; **issue:** #602; **M02 parent:** #24; **coordination:** #456.

## Twelve-sentence overview
1. M02's existing 49-group validator and source-master candidate detector provide redacted collision counts, not private source-row review locators.
2. A human reviewer must be able to find every potentially ambiguous Category/Unit record or cross-role Party row within an independently approved original export.
3. We will add a separate opt-in offline CLI without modifying the current public report CLI or its privacy behavior.
4. The CLI will accept exactly one private local source-shaped JSON input and a separate explicit private output path.
5. It will invoke the existing frozen full-source validator and existing advisory report before deriving private candidate locators.
6. The private output will contain only original source group names, original physical Sheet row positions, candidate cluster type and counts, never names, phone numbers, balances, Settings, credentials or raw source cells.
7. Distinct original Category/Unit records with exact nonempty display-name equality will appear together in stable, deterministic private clusters.
8. Cross-role exact nonempty Party name-and-phone equality will be expressed as review clusters containing original rows from every affected legacy role, without legal-identity inference or financial netting.
9. Input row ordering will not affect output; the private candidate counts must agree with the existing public-safe advisory report.
10. The output file will be created only once, with restrictive permissions and a no-follow exclusive temporary file followed by an atomic no-overwrite hard-link publication; failures will leave no partially published destination.
11. Test-first RED then minimal GREEN and full exact-head GitHub CI will verify owner boundaries, redaction, no-overwrite, symlink rejection, malformed source failure and deterministic review locators.
12. This produces only an offline review queue; real Google Sheets access, true D1 readback, account reconciliation and production cutover remain blocked under M03 #22, M10 #312 and M11 #306.

## Ownership and interfaces
**New paths only:** `scripts/dry-run-private-review-queue.mjs`, `tests/m02-private-review-queue-import.test.mjs`, this plan and `docs/reviews/2026-11-17-m02-private-review-queue-handoff.md`. Existing source verifier and advisory checker are imported **read-only**. No shared `src/db/**`, `migrations/**`, `src/rpc/**`, Worker, original GAS, Google Sheets or remote D1 modifications.

**Private invocation (after separate owner authorization):**

```sh
node scripts/dry-run-private-review-queue.mjs /private/source-49.json --private-output /private/review-rows.json
```

Default `dry-run-master-identity-review.mjs` behavior remains unchanged. This CLI will **not print** the private artifact path or its records; stdout is only the existing safe summary. Exit status `0` on successful file creation with no findings, `2` when findings exist or an unsafe/malformed read/write is rejected (in the latter case no summary/file). Private output directories must be trusted and never inside the GitHub working tree. Actual operator human judgments and account approvals remain outside this tool.

## Acceptance
- All 49 original group layouts must pass the existing frozen source validator before file creation.
- Category/Unit duplicate display-name cluster contains **all** original sheet-row locators, including distinct IDs and unsorted source rows.
- Multiple Party source roles sharing exact nonempty name+phone yield one deterministic private candidate cluster across groups; matching only one field does not produce a candidate.
- Private content excludes raw names/phones, financial amounts, Settings and staff credentials; public stdout/stderr exclude path/rows and all source values.
- File created exclusively with owner-only permissions; no symlink/hardlink overwrite, directory errors redacted, rejected input/oversized export leaves no output; temporary file cleaned.
- No automatic source identity merging or operational D1/release claims.
- GitHub RED→GREEN and 44-workflow exact-head CI + separate reviewer gate before merging.
