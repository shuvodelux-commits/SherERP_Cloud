# M04 HTTP auth response sanitization — Superpowers TDD

1. [ ] Read current AGENTS.md, MIGRATION_PLAN, M04 transport/legacy-bridge source, source-pinned auth return shapes; confirm isolated handler ownership.
2. [ ] Write fail-closed Node regression for nested credentials, malformed auth metadata, injected serializer fields and arbitrary failure text. Push **tests first** and observe expected RED in GitHub Actions.
3. [ ] Add minimal schema validation in opt-in `src/rpc/handler.js`; do not modify the public Worker, RPC registry, shared auth D1 schema or staff import.
4. [ ] Verify dedicated Node tests, entire Node suite and real Worker/D1 local CI including M04 auth, frontend/browser smoke, fixed source audit and Preview safety.
5. [ ] Mark PR ready only after eight GitHub Actions checks and exact-head Cloudflare Preview successful, HTTP 200 `database:not-connected`. Squash merge only if mergeable at the current head.

**No production auth enabled**; full login integration still needs approved private auth migrations, staff provisioning, security and cutover review.
