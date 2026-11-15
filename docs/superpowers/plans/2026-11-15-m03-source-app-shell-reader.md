# M03 source-faithful App Shell read — Superpowers plan

1. [ ] Re-read current GitHub AGENTS.md, migration workstreams, pinned UI.gs and existing Settings D1 reader; check parallel branch ownership.
2. [ ] RED: add a Node source-oracle test requiring `src/modules/source-app-shell-reader.js` before writing it. Verify expected `ERR_MODULE_NOT_FOUND` in a GitHub PR workflow.
3. [ ] GREEN: copy pinned `const NAV_ITEMS = [...] ;` verbatim, compose trusted `getAppShellSettings_()`, deep-clone `NAV_ITEMS` per response. No RPC integration or schema.
4. [ ] Add one or two real Workerd/D1 tests to the existing Settings integration harness without new external resources.
5. [ ] Run GitHub Node, M03/M04 real-D1, original frontend Chromium, source audit and PR Preview safety. Record exact-head CI and Preview HTTP 200 DB-free.
6. [ ] Squash merge only after GitHub checks all green, exact-head Preview deployed/verified and current main conflicts absent.

**Out of scope:** public `getAppShellData`, owner staff permissions, identity joins, financial posting and real D1 imports.
