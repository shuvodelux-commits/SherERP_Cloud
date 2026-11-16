# M01 — Fail-closed original browser authentication profile gate

> Superpowers workflow: plan → RED Node/Chromium regression → smallest compiled-output change → GREEN exact-head GitHub CI → owner merge only.

## Source, issue and intended behavior

**Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Respect `AGENTS.md`, `docs/MIGRATION_PLAN.md` and M01 in `docs/WORKSTREAMS.md`. In source `javascript.html::onAuthenticated_(payload)`, the client assigns `authToken`, `currentUser`, `allowedModules` and `permissions` and hides the overlay immediately, without checking the shape of the received profile. The original `filterNavByRole_` treats `allowedModules === undefined` like administrator metadata, so a malformed synthetic `{success:true,data}` response can reveal an unvalidated navigation shell. The reviewed M04 private HTTP handler validates its own responses already; this M01 change adds **browser defense in depth** only and does not grant any server permission.

1. Keep the original source HTML/CSS/JS byte-identical.
2. Extend only `scripts/patch-rpc.mjs` to insert a guard at the start of the compiled original `onAuthenticated_` function.
3. Verify a 64-character lowercase hex M04 token and a source-shaped user profile with nonempty identity, name, mobile and role.
4. Require the `allowedModules` and `permissions` fields to be present with valid role semantics: Administrator has both null; staff have an array and a record.
5. Reject missing navigation metadata, staff `allowedModules:null`, a fake administrator with staff permissions or invalid token by throwing `Invalid authentication response` before writing browser storage or hiding login.
6. Preserve valid merged M04 login and session-validation payloads and the existing original app-shell promise reuse.
7. Keep password errors and all failed authentication responses on the existing source login error path.
8. Test-first in Node with synthetic generated function text and real Chromium with test-only intercepted malformed login responses.
9. Assert malformed login responses never write `hwerp.session.token`, never hide the overlay and never build navigation or request protected business data.
10. Also check a valid synthetic staff profile still unlocks the source-shaped synthetic shell and retains role-filtered navigation.
11. Commit RED test sources before modifying the patcher, capture the actual failing GitHub Actions jobs, then apply minimal GREEN.
12. Verify exact-head Foundation, Chromium print/mobile, source integrity, Cloudflare PR safety and other required jobs; leave a reviewable draft PR unmerged.

## Boundaries and acceptance gates

The public Worker remains inert with login 503 and business RPC 501. No server-side authentication/authorization changes, new public RPC route, migration, D1 binding, original GAS/Sheets writes, POS/finance/cash/stock/Party data or Cloudflare deployment changes. Browser role metadata remains **presentation-only**, never authorization; protected server actions require M04. The successful synthetic login is not a real business session. If tests show incompatibility with frozen-source/M04 return shapes, stop and adjust the guard rather than silently changing source contracts. Owner reviews and merges only after complete CI passes.
