# M03 Run 8 — preserved client RPC to frozen async impact audit

**Workstream:** M03 #22 · **Coordination:** #456 · **Base:** GitHub main at branch creation (observed \`e81e243b94ff7712ae6c42392ae4fc4c763faf8d\`) · **Pinned original:** Mohim_ERP@\`29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2\`.

## 12-sentence implementation overview

1. M03 already has a pinned 394-function source GAS async-impact closure, but that is not a client RPC handoff audit.
2. The original frontend's \`serverCall('name',...)\` usage must be linked to its matching source GAS function before real Worker/D1 conversion can be accepted.
3. This run will inspect inline JavaScript script blocks in preserved HTML without executing any source code.
4. Static literal RPC names will be matched to the existing pinned transitive affected-function inventory.
5. For each matched entry the audit will retain the original read and write call paths and source GAS file.
6. Static calls absent from the *affected* inventory will be labeled unknown to that inventory, not falsely labeled safe or implemented.
7. Dynamic RPC dispatch will be listed separately for manual review instead of being silently skipped.
8. A JavaScript script block that cannot be parsed will generate an explicit review item instead of being counted as safe.
9. HTML event-handler attributes, indirect wrappers and runtime dispatch remain outside this limited static audit and require later separate review.
10. The audit will preserve deterministic output order and will never print arguments, customer data or original script bodies.
11. TDD will first demonstrate failure against an unimplemented audit, then implement a pure parser and run the Node test suite and existing full GitHub CI.
12. The result remains nondeployable evidence: no shared D1 schemas, public RPC, Worker bindings, auth, financial writes or production readiness are changed.

## File scope and acceptance

- New \`scripts/audit-m03-client-rpc.mjs\`: pure AST-based inline-script callsite triage, plus read-only \`--summary\` CLI.
- New \`tests/m03-client-rpc-audit.test.mjs\`: positive static and dynamic calls, source-path classification, comments/string false-positive negatives, malformed script fail-visible, deterministic output and input validation.
- This plan file only. No edits to ongoing M03 #769 first-purchase fixture/spec, M01 UI or M11 CI.
- CLI loads existing \`docs/baseline/m03-async-caller-closure.json\` and preserved \`legacy/source/*.html\`, and reports a source-only audit summary.
- This scan **cannot** determine if the D1 implementation exists, whether it correctly awaits the source graph, or whether SQL authorization/posting is safe.
- Merge requires full exact-head CI, independent review and human-approved main integration; no remote writes or deployments.
