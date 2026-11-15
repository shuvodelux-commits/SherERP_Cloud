# M00 Dynamic Client RPC Closure Plan

**Source:** frozen Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
**Scope:** independent audit owner, only new `scripts/audit-m00-dynamic-rpc.mjs`, new tests, new baseline and docs. No production Worker/RPC/UI/DB changes.

- [x] Write failing tests for both ternary products callsites and both six-choice vendor table callsites against synthetic HTML JS.
- [x] Test missing backend owner, duplicate ownership, changed/new dynamic browser call, unsafe dynamic target, assignments and vendor helper shape rejection.
- [x] Run RED against missing audit module.
- [x] Implement minimal Acorn-based AST parser/resolver and comparison with existing M00 lexical inventory.
- [x] Generate frozen real-source snapshot from all 37 HTML and 47 .gs source files; inspect four resolved callsites manually and add CLI round-trip check.
- [x] Run targeted GREEN, npm test, pinned source verify, frontend build, drift/syntax checks.
- [ ] Reconcile latest main, publish isolated PR and check GitHub CI. Never enable server-side RPC by inventory alone.
