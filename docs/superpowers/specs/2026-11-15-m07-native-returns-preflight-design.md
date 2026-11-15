# M07 Native Returns/Corrections — Preparation Design

**Date:** 2026-11-15. **Status:** bounded preflight specification; no financial writer activation.
**Goal:** Preserve original native returns/edit/delete semantics while M05/M06/M04 posting interfaces remain gated, and hand the M07 implementer an explicit regression baseline.

## User-visible intent and constraints

Operators continue using the existing Sales Return cart, multi-invoice customer picker, Purchase Return, Return History and original Sales/Purchase Edit/Delete actions; the Cloudflare port must not change the original UI or introduce a generic correction center. Corrections must restore precisely the goods/lot and monetary obligations created by the source transaction once, even under concurrent requests and partial failures.

Pinned source: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; mirrored unmodified in `legacy/source`. The original repository, GAS deployments and live Sheets are read-only; no production D1 access.

## Approaches considered

1. **Directly convert GAS returns into callable Worker RPCs today:** rejected. M06 atomic posting and M04 trusted actor/permissions are unfinished, and transitive Sheet/LockService calls are synchronous. A callable port would permit half-applied money/stock.
2. **Build a new generic correction journal/center:** rejected. Original AGENTS.md forbids a second correction engine; native edit/delete must remain the authority.
3. **Selected: isolated source contract and executable characterization tests first**, then atomic implementation in **one reviewed shared posting owner** after M05/M06 schema/receipt interfaces freeze. Smaller, non-deployable PR; reveals regressions without unsafe writes.

## Preflight scope (this branch)

- Add source-faithful impact/RPC inventory and D1 handoff requirements in `docs/M07_RETURNS_SOURCE_CONTRACT.md`.
- Execute pure original pricing/lot planning and early batch validation in a VM with no actual Google Sheets writes, capturing expected outputs and rejection cases.
- Maintain original byte hashes and frontend/UI unchanged; no new public RPC, D1 migration or production accounting code.
- Verify source manifest and regression suite. Distinguish Node source-behavior tests from future Workerd/D1 integration.

## Implementation boundary after gates

The M07 domain layer must call the approved M06 posting kernel. Each return/correction should bind authenticated tenant/actor, original source ID/legacy link, stable operation ID, exact canonical payload hash, Cash Session policy, expected source version, per-child/lot allocations and audited immutable receipt. Use **one D1 atomic boundary** with SQL-enforced source quantity, account and version guards. Readback is permitted only on authorized original receipt; failure/ambiguous state returns Needs Review. Keep original native RPC signatures/response envelopes and browser handlers.

Do not implement it in this preflight PR. No single-Party net balance, client-chosen actor, duplicate correction API, non-atomic JS preflight/postflight or second D1 deployment owner.

## Explicit risks and owner decisions required later

- A batch with one contributing invoice dispatches to native single return, but two or more must share one atomic batch boundary and preserve child Return IDs.
- Store Credit return needs a reviewed customer identity link; a walk-in single return's old auto-create behavior must not silently merge Parties.
- Split-payment original tender and later settlement allocation may block return/edit/delete until M06 source-level receipt and M08 ledger adapters are ready.
- Legacy fallback lot, mixed vendor/own stock, previously resold returned inventory and uncertain original journals require deliberate Needs Review, not synthetic stock balancing.
- New `PARALLEL-MODULE-READY` status may only be changed after its separate full checklist, never on the basis of this PR.

**Acceptance:** contract inventory and tests added, full local Node/source/frontend validation observed, no non-test financial changes. This is **M07-P0 preflight**, not M07 complete.
