# M03 Executable Browser RPC Inventory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and test-driven-development task-by-task. This implementation is GitHub-first and test-evidenced.

**Goal:** Remove inert/comment/example RPC false positives without losing real original browser callsites or weakening public RPC fail-closed state.

**Architecture:** Reuse `acorn.tokenizer` (already installed), extracting line-delimited `<script>` sections from the frozen HTML. Classify only `serverCall` identifier tokens followed by a call parenthesis, and preserve legacy output shape plus source-pin and registry guards.

**Tech Stack:** Node.js ESM, existing Acorn 8.19.0, Node built-in test runner and GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-16-m03-executable-rpc-inventory-design.md`

## Global constraints

- Frozen original SHA `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
- No new packages, DOM/UI edits, original GAS/source modifications, D1 schema changes, Worker bindings, production endpoints or remote writes.
- Preserve exact prior report `summary` keys, blocked `methods`, and `dynamicSites` shape for consumers.
- Public `/api/rpc` remains fail-closed; no M04 auth gate is weakened.
- Verification: expected test-only RED GitHub CI → minimal GREEN → full exact-head tests, including original UI and local Workerd/D1 CI.

## 14-sentence overview

1. The previous M03 PR #307 established the frozen browser RPC inventory and its 394-function backend impact relationship.
2. The original HTML files contain real inline JavaScript and inert HTML text.
3. The current raw regex conflates example strings and comments with executable calls.
4. The shared `javascript.html` even documents `someFunction` as an example which is incorrectly counted.
5. The immediate deliverable is a more accurate inventory rather than any public endpoint.
6. Extract the original standalone `<script>` block from each HTML file, preserving its physical line offset.
7. Tokenize the JavaScript without evaluating source code or importing GAS services.
8. Distinguish actual `serverCall` expression tokens from comments, strings, regular expressions and function declarations.
9. Count exact quoted names as literal RPC callsites.
10. Keep variable expressions and template-literal names in a dynamic review queue.
11. Do not attempt to resolve dynamically chosen functions or claim they are authorized.
12. Refuse malformed script boundaries or JS tokens rather than silently undercounting.
13. Preserve source pins, reporting schema, and zero public registry handlers.
14. Run GitHub test-first RED and full GREEN regressions, then request review without merging automatically.

## Review focus

- A malformed script or unclosed string must not silently produce partial results.
- `serverCall` in a comment or string must not be shown as callable.
- `function serverCall` or `obj.serverCall` must not count as the global transport.
- Literal calls inside nested callbacks/ternaries and template interpolations must remain visible.
- Dynamic arguments must remain explicitly unresolved rather than misclassified as migrated.

### Task 1: Test real executable detection

**Files**
- Create `tests/m03-rpc-executable.test.mjs`

**Interface:** Existing `buildM03RpcReadiness({sourceCommit,closure,registry,htmlFiles})`.

- [ ] Add regression fixtures: HTML comment, script comment, string, regex, template text, function declaration, member method, exact literal calls and dynamic names; assert just the executable global calls.
- [ ] Add physical script-line offset and duplicate call count assertions.
- [ ] Add malformed source case rejecting unclosed script blocks and JS strings.
- [ ] Run `node --test tests/m03-rpc-executable.test.mjs` via GitHub Actions; expected RED: the current raw regex counts inert calls and accepts malformed scripts.
- [ ] Commit test-only before implementation and preserve GitHub failing logs.

### Task 2: Minimal scanner correction

**Files**
- Modify `scripts/audit-m03-rpc-readiness.mjs` (script segment parsing + Acorn tokenizer only).

**Interfaces:** Same `buildM03RpcReadiness` call and output schema.

- [ ] Replace raw regex scanning with script-block extraction and token recognition.
- [ ] Use genuine JavaScript token `loc` plus source script offset for `dynamicSites.line`.
- [ ] Preserve source SHA, closure validation, empty public registry and CLI checks.
- [ ] Run targeted test file plus existing `tests/m03-rpc-readiness.test.mjs`; expected both suites GREEN.
- [ ] Commit the smallest correction.

### Task 3: Whole-branch review and verification

**Files:** No production edits unless a reproducible failure requires TDD.

- [ ] Verify `node scripts/audit-m03-rpc-readiness.mjs --check`, full `npm test`, original preserved UI browser QA and local Workerd+D1 Actions on exact GREEN SHA.
- [ ] Confirm no unexpected file changes or public Worker/D1 activation.
- [ ] Open/update a draft PR with original function/RPC/table impacts, RED→GREEN links, CI evidence and remaining dynamic-dispatch limitation.
- [ ] Stop for owner review/merge. This is a preparatory audit, not M03 phase completion.
