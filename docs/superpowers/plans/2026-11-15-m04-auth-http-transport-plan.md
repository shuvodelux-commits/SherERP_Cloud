# M04 gated auth HTTP transport — Superpowers RED/GREEN plan

1. [x] Read current GitHub `AGENTS.md`, M04 source contract, handler/registry, and D1 legacy bridge. Agree scoped security boundaries and file/RPC impact.
2. [x] RED: create tests for `handleRpc(request,{authAdapter})` three-method allowlist, exact arguments, browser safety guards, source envelopes, generic backend failures, and unchanged production fail-closed behavior. Run failing GitHub PR workflow before changing handler (RED commit `b174b3742d3399094b0c3938a0b25262ca206e8f`: expected 503 vs 200 and 503 vs 400 in CI).
3. [x] GREEN: add the minimal optional trusted adapter dispatch path to `src/rpc/handler.js`; preserve public `src/index.js` caller and empty registry.
4. [x] Add separate test-only Worker with fake D1 UUID, server-owned clock, source-shaped normalizer, and Workerd/D1 login→restore→logout and disable tests; import it into existing M03 Workerd integration entry. No deployed route.
5. [ ] Verify GitHub CI: Node, Worker/D1, source manifest, original frontend Chromium, staging local D1 and Preview safety checks; require exact-head Cloudflare Preview deployed DB-free HTTP 200 before squash merge.

**GREEN evidence:** GitHub Actions on `8bd170a91600f42d3340df61ff4c62adb46f076b` completed all seven PR workflows successfully, including full real local Workerd/D1 integration. Cloudflare exact-head deployment confirmation is still separately required.
