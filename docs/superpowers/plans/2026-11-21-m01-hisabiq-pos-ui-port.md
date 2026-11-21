# HisabIQ POS V2 Owner UI Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Execute TDD before code and inspect Playwright before/after captures.

**Goal:** Bring the authenticated Owner POS cart composition closer to the pinned HisabIQ POS without changing financial posting contracts.

**Architecture:** Compile-only opt-in CSS/DOM enhancement, mounted after Owner legacy frontend build. Reuse existing POS handlers and source catalog. Keep legacy frontend immutable.

**Tech Stack:** Node ESM, existing bundled HTML/JS, CSS, Playwright Chromium, GitHub PR.

**Spec:** `docs/superpowers/specs/2026-11-21-m01-hisabiq-pos-ui-port.md`.

## Global constraints
- No new dependencies or schema, no backend/Worker route mutations.
- No fake multi-unit or payment functions: existing server gate wins.
- Source UI `hisabiq_ui@e42a00a9`, sizes and themes from canonical design contract.
- Preserve Classic POS and all source DOM IDs, source manifest unchanged.

## Review focus
- 320px amount/line total and Remove cannot clip or hide.
- All checkout input IDs and button handlers survive DOM enhancement.
- Switching POS -> other page -> POS does not duplicate toolbar or lose source handlers.
- Server-disabled payment features remain disabled; no new client-side posting.
- Touch, keyboard, reduced motion, external dark theme and Bangla overflow.

### Task 1: Compiled-Owner injector and scoping
- [ ] RED: contract test expects injector, scope, duplicate rejection, and immutable original source.
- [ ] GREEN: implement safe Owner-only asset patch and attach it in Owner builder.
- [ ] Run focused tests and compile.

### Task 2: Reference hierarchy and responsive cart
- [ ] RED: Playwright verifies actual Owner layout, quick items and all panels at 320/390/768/1024/1440.
- [ ] GREEN: build opt-in POS controller and scoped tokens/CSS.
- [ ] Capture reference/baseline/after screenshots; inspect visually, fix bounded issues.
- [ ] Verify browser keyboard and source accounting guardrails.

### Task 3: Ship reviewable PR
- [ ] Test full affected suite and source manifest, run CSS visual checks.
- [ ] Commit screenshots and matrix report; open non-merged PR; disclose missing /ui-refine-skill and backend conversion gap.
