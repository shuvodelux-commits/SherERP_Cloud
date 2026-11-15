# M00 pinned browser dynamic RPC first-argument closure (2026-11-15)

## Decision
The 37 preserved source HTML snippets include four dynamic `serverCall(...)` callsites (products ×2, vendors ×2). The existing lexical M00 inventory deliberately leaves them unresolved; the M04 RPC allowlist must not infer arbitrary dispatch from client-supplied strings. Add a **source-only, AST-checked, reviewer-owned closure audit** without touching `src/rpc`, `src/db`, `src/index.js`, original `legacy/source` or public Worker routes.

Authority: `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/baseline/m00-rpc-contract-inventory.json`, pinned Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; original `ProductSettings.gs`, `DeleteEngine.gs`, `Vendors.gs` and others.

## Static evidence and resolver decisions
1. Parse JS extracted from each original HTML `<script>` section using **pinned dev-only acorn@8.19.0**. Detect call expressions with direct `serverCall` callee; excluded shared `function serverCall` definition as it is not a call expression.
2. For `serverCall(fn,...)`, resolve only an in-scope, prior, local immutable `var fn = <condition> ? 'literal1' : 'literal2'` where both branches are literal identifiers. Other expressions or later reassignment fail closed. Source currently uses `prodManageListMode_ === 'category'` or local `mode === 'category'`. Record both alternatives as candidates, **not as an approved allowlist**.
3. For `serverCall(handlers.get/update,...)`, resolve only `handlers = vendorNativeTxnHandlers_(type)` and the exact helper `vendorNativeTxnHandlers_` returning a static `map[type] || null` where `map` is an ObjectExpression with literal keys and values containing literal `get/update` fields. Dynamic values/spreads/methods/duplicate keys/unsafe mutation must fail closed. Record corresponding six Vendor transaction type candidates per property, including the `Issue` path, **regardless of whether the frontend currently routes to that edit form**. A different property or missing field fails closed.
4. Every target name must resolve to exactly one top-level `function NAME(...)` in pinned GAS .gs modules; missing/duplicate definitions are errors. This is a **defined-name check only**, never evidence that the function is secure, transactionally ported, permissioned, or exposed by Worker.
5. Compare parser-detected dynamic callsites with previous lexical M00 inventory exactly (file+line); any new or removed dynamic site is drift. Snapshot `--check` rejects target changes and demands reviewer update; no silently added allowlist.

## Output / constraints
- `scripts/audit-m00-dynamic-rpc.mjs` exports `auditM00DynamicRpc({sources,sourceCommit})` and `assertM00DynamicRpcSnapshot`; CLI `--write|--check` reads frozen original source files, old M00 snapshot and produces `docs/baseline/m00-dynamic-rpc-closure.json`.
- 4 callsites → 2×2 Product names and 2×6 Vendor names, **16 total per-site target appearances** (some duplicate method names across different calls).
- Tests ensure safe resolution, source-shadowing/reassignment refusal, dynamic/missing vendor mapping, missing backend definitions, source drift, CLI check and original snapshot. No node dependency changes.
- No code generation, no runtime registration, no permission grants, no data changes, no Cloudflare writes or migrations.
- **Parallel financial-module readiness remains blocked.** M04 owner must separately validate auth permission, source-signature parity and server-side allowlist.

## Alternatives rejected
- Permit all `serverCall` values dynamically at runtime: violates fail-closed security.
- Replace original frontend `serverCall(fn,...)` with literals: changes preserved UI and source.
- Regex-only guesses: cannot distinguish object keys, local bindings or source mutation reliably.
