# M02-P Party Import Validation — Approval Evidence Test-First Plan

> **For agentic workers:** follow Superpowers RED → GREEN → refactor → verify and use GitHub branch, commits, PR and Actions evidence. Do not auto-merge or modify live import data.

**Goal:** Ensure a readback report never claims a reviewed Party identity link's approval evidence persisted when reviewer, timestamp or reviewed-link basis has changed.

**Scope:** One existing pure read-only validator `src/party/import-readback-reconciliation.js`, one new Node regression test, this plan and its spec. No D1 migration, import writer, Worker RPC, auth, UI, source file or financial account changes.

**Source and design:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; ADR-007; `docs/superpowers/specs/2026-11-15-m02-party-readback-review-evidence-design.md`. Keep PR #144's duplicate-ID planner separate.

### Task 1 — RED (test only)
- [ ] Read `AGENTS.md`, M02-P guidance, current source-shaped planner/readback code and relevant tests.
- [ ] Add `tests/m02-party-readback-approval-evidence.test.mjs` using existing synthetic reviewed Party import fixture, direct `planPartyImport` and actual `reconcilePartyImportReadback`. Test exact human-link provenance loss for `reviewed_by`, `reviewed_at`, `link_basis` while `approval_ref` remains correct.
- [ ] Create draft PR on a dedicated GitHub branch before implementation; inspect GitHub Foundation RED showing the intended assertion mismatch (`true !== false`), not syntax/setup failure.

### Task 2 — GREEN (minimum patch)
- [ ] In `src/party/import-readback-reconciliation.js` only, let any mismatch among four verified approval-evidence fields set `approvalEvidencePersistent=false` for a proposed `HUMAN_VERIFIED` legacy link. Do not suppress `FIELD_MISMATCH`, expose values or alter approval reference absence logic.
- [ ] Confirm original reviewed evidence/readback parity succeeds, altered evidence fails closed, unrelated original-link mismatch keeps the flag semantics, no mutation or raw identity leakage.
- [ ] Verify focused test and full Node GitHub Foundation suite (source checksums, frontend build).

### Task 3 — integrate and review
- [ ] Require all applicable GitHub CI (M02 local real Workerd/D1, M03 Worker D1, M04 auth, M01 browser, Cloudflare preview safety) to complete green on exact final head.
- [ ] Compare against fresh `main` and sync nonoverlapping concurrent branches if necessary; PR diff must be these four files only.
- [ ] Record RED/GREEN run IDs, final counts, privacy/scope and revert plan in PR. Mark ready for owner review only after all checks pass, and do not merge without owner instruction.

**Test scope:** pure readback parity is synthetic; existing Workerd/D1 workflows validate unrelated integration behavior and are not proof of full source Party import or financial posting. **Release gate remains closed.**
