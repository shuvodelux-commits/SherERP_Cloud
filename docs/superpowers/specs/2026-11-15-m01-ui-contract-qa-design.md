# M01 Compiled UI Contract QA — Design (2026-11-15)

## Intent
Protect SherERP's original HTML/CSS/vanilla JS shell while M03/M04 can evolve independently. This is an **M01-UI QA** lane under `docs/M03_PARALLEL_READINESS.md`, not approval for M05/M06/M08 posting work.

## Source and constraints
- Pinned `Mohim_ERP` source SHA: `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
- The copied `legacy/source` remains byte-identical; no original repository writes.
- The Worker shell remains inert; no D1 migrations, public RPC enablement, secrets, or production writes.
- Preserve DOM IDs and original print/mobile CSS, the floating scrollbar, and `serverCall(fnName, ...args)`.

## Approaches considered
1. **Only frozen source checksums:** catches source drift, but cannot catch accidental generated-markup loss or broken patching.
2. **Playwright-only UI snapshots:** stronger behavioral/visual assurance, but browser runtime and golden screenshots are not yet configured in this repository.
3. **Compiled-HTML contract audit + isolated mutation tests (selected):** dependency-free CI guard now, with Playwright acceptance required later.

## Design
The read-only `scripts/check-m01-ui.mjs` analyzes the assembled, RPC-patched `dist/index.html`. It ignores comments, CSS and JS template strings when counting live DOM IDs. It requires each protected shell ID exactly once, checks source-specific print pagination and the 860px mobile breakpoint, confirms the floating-scrollbar/print host controller references, and requires the patched same-origin fetch transport rather than the legacy GAS runner.

The inspector returns an array of human-readable errors. The optional CLI exits nonzero on any violation. `tests/m01-ui-contract.test.mjs` builds the original includes in a disposable directory, patches the RPC adapter in memory and exercises both unmodified and deliberately mutated outputs. Running `npm test` therefore enforces the new gate without a second deployment mechanism.

## Non-goals / open gates
This scanner is **not** a DOM parser, a real browser, or proof of runtime DOM handlers, visual layout, mobile touch behavior, A4 pagination, invoice data, or accounting parity. M01 still requires Playwright screenshot/interaction and actual print acceptance. No runtime UI or backend code is changed in this workstream.