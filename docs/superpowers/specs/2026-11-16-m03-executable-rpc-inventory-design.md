# M03 — Executable browser RPC inventory, source-faithful design

**Source:** frozen Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, original 37 HTML inputs, existing `scripts/audit-m03-rpc-readiness.mjs`, and `docs/baseline/m03-async-caller-closure.json`.

## Intent and constraints

The merged M03 readiness audit currently matches raw `serverCall(` text in all HTML, including comments and string literals. In the original `javascript.html`, its example `serverCall('someFunction',...)` is a comment, not an executable RPC. Counting such examples distorts the true per-method migration backlog. The next step must distinguish *executable JavaScript call tokens* from demonstration text while preserving the same report shape used by the merged tests. The frozen UI, backend and original data must not change. Dynamic calls remain unresolved pending a deliberate source-tracing review, and all public methods remain `blocked`.

## Approaches and decision

- **Continue raw regular expressions:** smallest diff, but knowingly reports comments, script documentation and string content as RPC calls — rejected.
- **Parse every entire HTML file as JavaScript:** unreliable because HTML markup and included page templates are not JavaScript — rejected.
- **Recommended: extract original inline `<script>` regions and tokenize them using the repository's existing Acorn dependency.** Acorn tokens exclude comments, strings, regular-expression bodies and inert template text from call matching, while preserving line/filename and dynamic-argument detection. Full expression/binding resolution is deliberately not claimed.

## Acceptance

1. Preserve the current report's `summary`, `methods`, `dynamicSites`, source pin and blocked-public-registry contract.
2. Count literal `serverCall('name',...)` and `serverCall("name",...)` only as actual JavaScript tokens; keep accurate call-site counts and line positions.
3. Exclude comments, string bodies, regular expressions, script documentation, HTML attributes and the declaration `function serverCall(...)`.
4. Preserve unresolved `serverCall(fnName,...)` and nonliteral template arguments as dynamic review sites; do not mislabel them as verified calls.
5. Refuse an unterminated source script block or malformed tokenization instead of silently reporting partial coverage.
6. Preserve unwrapped JavaScript fixtures in test-only input and all 37 original HTML source files in the live audit.
7. Execute source-pin, 394-impacted-function closure and empty public registry checks unchanged.
8. Keep public `src/index.js`, `src/rpc/`, `src/db/`, SQL migrations, M04 security, original HTML, Cloudflare Worker bindings and remote D1 untouched.
9. Tests are written first and their expected failure verified in GitHub Actions before replacing the lexical scan.
10. Completion is a narrowly verified client-RPC inventory improvement, **not** a source-backed D1 read/write path or production enablement.
