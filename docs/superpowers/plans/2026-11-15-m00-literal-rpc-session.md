# Superpowers TDD — Literal browser RPC session boundary (M00)

Source: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

1. [ ] **RED:** commit `tests/m00-literal-rpc-session.test.mjs` with full 172-site/129-name source fixture and four precisely scoped exception expectations. Mutation tests replace `authToken`, rename one original backend `token` formal, swap login arguments, and attempt extra pre-session use. Record deliberate GitHub `ERR_MODULE_NOT_FOUND` for missing audit module.
2. [ ] **GREEN:** implement a minimal read-only Acorn AST audit reusing `auditM00RpcContracts`/snapshot. For nonexception literal calls require browser `authToken` and GAS formal `token`. Four reviewed `javascript.html` exceptions preserve the exact original phase and arity.
3. [ ] Add compact deterministic JSON source snapshot and `--check|--write` CLI. Re-run tests, source integrity (84 files) and all eight existing GitHub workflows.
4. [ ] Inspect PR file diff (exactly five new M00 files), main advancement and CI; if no overlap rebase to current GitHub main and reverify. Do not merge a new PR without owner approval.
5. [ ] Clearly report nonclaims: no M04 authorization, no production Worker RPC endpoint, no financial posting, no D1 migration or runtime transaction adaptation.

## Observed findings

GitHub first RED `e3aa199e34eb328022c81d82f704bb98e423e226` failed missing module. GREEN revealed undercount in prior lexical source inventory: 204 AST vs 172 lexical, 155 vs 129 method names, exactly 32 uncovered callsites. A real-source regression and a compact locked 32-gap snapshot are now added; source functions, original UI and existing legacy inventory deliberately remain unchanged. Follow-up M00 scanner reconciliation is required before declaring every RPC mapped.
