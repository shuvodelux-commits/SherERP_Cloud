# M06 Invoice Timezone Child Runner Stability Implementation Plan

> **For agentic workers:** Follow Superpowers failing-test → minimal fix → passing test → full regression → GitHub PR.

**Goal:** Preserve source invoice due-date regression coverage on Node 22 and Node 24 by making the nested Node test-runner output deterministic.

**Architecture:** The existing test spawns a child Node process under UTC and Asia/Dhaka, and validates the complete 14-case source invoice suite by matching the TAP plan and count. On current Node 24, the child defaults to the spec reporter, so every child assertion succeeds but the parent rejects missing TAP plan text. Add explicit `--test --test-reporter=tap` Node CLI arguments to that child; change neither its invoice/date assertions nor any production finance code.

**Tech Stack:** Native `node:test`, `spawnSync`, pinned legacy invoice fixtures.

**Spec:** `tests/m06-invoice-timezone-regression.test.mjs`, issue #92 original invoice timezone parity; regression discovered during issue #690 full Node run.

## Task 1: Reporter-neutral M06 regression
- [x] Reproduce the parent test failing on Node 24 because child tests emit spec reporter: `TZ=UTC node --test tests/m06-invoice-timezone-regression.test.mjs` returns 1 despite child 14/14 pass.
- [x] Explicitly invoke TAP test mode in both spawned child TZ environments, without parsing locale-specific prose or disabling test-count checks.
- [x] Re-run the parent test and ensure it passes, proving all 14 child checks twice; retain UTC and Asia/Dhaka coverage.
- [x] Verify source manifest, docs, syntax, accounting/invoice tests and relevant Node CI.
- [ ] Create a scoped M06 test-only PR from current main, review exact-head CI and merge only after approval.

This does not change customer business data, Cloudflare, D1, invoice math, print output, release approvals or application runtime behavior.

**Verification evidence (Node 24.22.3 on CachyOS):** RED on exact base `090c5a4b` (1 failed); GREEN parent (1/1); affected invoice tests (15/15); full `TZ=UTC node --test` **4,192 passed, 0 failed**, 84/84 source files verified, docs checks green. Child test runtime is forced to TAP and remains independently exercised in both UTC and Asia/Dhaka. CI of PR head must be checked separately.
