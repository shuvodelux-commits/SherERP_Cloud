# Superpowers M00 dynamic RPC session-token position — implementation

**Source SHA** `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

1. [ ] **RED**: Commit a standalone Node regression suite importing non-existent `auditM00DynamicRpcSessionFirst`; test four sites, 16 targets, mutation of product and vendor first token argument, backend first formal mismatch, no source mutation and a checked CLI; obtain explicit GitHub CI failure.
2. [ ] **GREEN**: Implement minimal AST read-only audit that reuses existing pinned `auditM00DynamicRpcArity` and snapshots. Require `authToken` in browser arguments[1] and `token` in every backend formal[0]. Check ambiguous callsites; no RPC activation.
3. [ ] Add fixed snapshot `docs/baseline/m00-dynamic-rpc-session.json`, `--write|--check` support, and rerun GitHub Foundation suite, source verification 84 original files, local workerd D1 (integration safety), M01 Chromium and preview checks.
4. [ ] Ensure only five M00 files changed, check mergeability and conflicts against current `main`; use a dedicated GitHub branch/PR and preserve RED/GREEN CI evidence.
5. [ ] Do **not** claim M04 auth integrated, source login working, or enable any method; 172 literal RPC contracts remain separately tracked.
