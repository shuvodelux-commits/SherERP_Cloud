# M00 source-only dynamic RPC positional parity — design

## Why
The original pinned SherERP HTML has **four** nonliteral `serverCall` callsites. Approved M00 source audit PR #62 maps these to **16** possible original GAS handler names. A handler can be correctly named and still receive too few or too many positional inputs, making future M04 allowlist migrations silently incompatible.

## Contract
`auditM00DynamicRpcArity({sources,sourceCommit,lexicalSnapshot,dynamicSnapshot})`:
1. Validate pinned input by re-running the already reviewed lexical and dynamic target inventories. If `dynamicSnapshot` supplied, its exact serialized structure must match the computed result.
2. Parse original `<script>` blocks with pinned Acorn; map each reviewed `{frontendFile,line,argumentSyntax}` to **one** `serverCall` AST call. The first argument selects the method and is **excluded** from positional RPC input count. Require 1+ arguments and no spread; do not count `withLoader`/modal wrapper arguments or token from another call.
3. Parse corresponding pinned GAS file with Acorn, require exactly one top-level declaration with that method name and only simple `Identifier` formals. Compare `clientArgs` against `backendParams` for **every** candidate named in the approved dynamic closure; mismatch fails. Do not infer optional/default/destructured semantics.
4. Output deterministic `formatVersion:1`, source SHA, limitations methodology, `counts:{dynamicCallsites,possibleTargetPairs,matchedTargetPairs}` and `callsites:[{frontendFile,line,argumentSyntax,clientArguments,targets:[{name,backendFile,backendArguments}]}]`.
5. The existing four source calls are `products.html:997` (2 args), `products.html:1030` (3), `vendors.html:1062` (2), `vendors.html:1153` (3). All 16 GAS signatures match their callers today. Different source signatures require a deliberate snapshot review.
6. This script has **no** D1, auth, Cloudflare, RPC registration, legacy source mutation or business change. In particular, it never treats candidate names as safe client-authorized endpoints.

## Security and test coverage
- Reject extra/missing first-argument site, skipped site, ambiguous same-line AST call, spread, malformed GAS declarations, signature mismatch and inventory tampering rather than silently skipping.
- Fail on source drift and unknown CLI modes; pinned corpus and checked-in JSON parity tested in Node CI.
- No raw business records or credentials are output; only function/file names and arities from frozen source.
