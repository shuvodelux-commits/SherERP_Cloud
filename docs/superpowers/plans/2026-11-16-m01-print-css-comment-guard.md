# M01 — Ignore commented-out CSS when validating invoice print rules

> For agentic workers: REQUIRED Superpowers executing-plans, test-driven-development, verification-before-completion. Prove a failing test before editing production logic.

**Goal:** Keep the M01 compiled frontend CI contract check fail-closed when required invoice-print styling exists only in CSS comments.

**Authority:** `AGENTS.md`, `docs/WORKSTREAMS.md` M01, `docs/MIGRATION_PLAN.md` P1, frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

**Architecture:** Only change `scripts/check-m01-ui.mjs`, a static validation script. After collecting the existing `<style>` bodies, remove CSS block comments before searching for active mobile and invoice-print rules. The original CSS/HTML/JS, generated output, Worker, D1 and UI remain byte-identical.

**Stack:** Node.js `node:test`; existing Foundation and M01 Chromium CI workflows.

## Constraints
- No source or generated UI edits, no redesign, no changes to RPC, D1, auth, migrations, data migration, financial operations, CI deployment or Cloudflare preview.
- Retain all required CSS contract checks and error messages, including A4 repeating invoice table header, row non-splitting, print host visibility and 860px mobile breakpoint.
- No new dependencies or CSS parsing library.
- Static tests are complementary to browser/print QA, not proof of authenticated integrated D1 ERP.

## Task 1: RED before implementation
**Modify:** `tests/m01-ui-contract.test.mjs`
- [ ] Build the real frozen UI using the existing fixture.
- [ ] Replace active `display: table-header-group;` with `display: table-row-group;`; append a `<style>/* body.printing-invoice .inv-table thead { display: table-header-group; } */</style>` decoy. Require `repeating invoice table header missing`.
- [ ] Replace the real `@media (max-width: 860px)` with 600px and append a commented 860px decoy. Require `860px mobile breakpoint missing`.
- [ ] Commit tests first, record GitHub Foundation RED failure for the correct assertions.

## Task 2: Minimal GREEN
**Modify:** `scripts/check-m01-ui.mjs`
- [ ] Strip CSS `/* ... */` comments only from the checker-local combined CSS string, *not* from source or generated HTML.
- [ ] Confirm targeted regression GREEN and existing CSS/print/RPC/DOM checks pass in full `npm test`, frozen-source checksum, frontend assembly and real Chromium/printing CI.
- [ ] Review exact PR diff, RED→GREEN job logs, full exact-head check status, record outstanding project release gates, owner reviews and merges.

## Impact and review focus
- Only this plan, one static test, one static checker.
- Confirm real active CSS still passes, commented decoys never satisfy required rules, valid script/template handling untouched.
- No schema, RPC, posting, Party, stock, cash, bank or ledger impact.
