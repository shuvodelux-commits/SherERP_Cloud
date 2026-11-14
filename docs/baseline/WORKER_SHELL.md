# Worker shell — current M01 limits

## What exists
- `wrangler.jsonc` configures a Cloudflare Worker and Worker Static Assets from `dist/`.
- `npm run build:frontend` expands all original HTML includes, then patches only the generated JavaScript `serverCall(fnName, ...args)` to use JSON POST `/api/rpc`.
- `GET /api/health` explicitly returns `{"status":"foundation","service":"shererp-cloud","database":"not-connected"}`.
- Other `/api/*` paths return 404. The RPC endpoint rejects malformed, cross-origin, oversized and non-POST requests, then returns HTTP 501 for any business method.
- The registry is deliberately empty. **No legacy server method has been made public or operational.**

## Commands
```bash
npm test
npm run verify:source
npm run build:frontend
```

After installing a compatible Wrangler locally, `wrangler dev` can be used for a local Workers runtime smoke test; do not deploy production or create a D1 binding yet.

## Outstanding gates
1. Actual Cloudflare Workers runtime smoke test and browser parity tests.
2. Complete HTTP RPC registry inventory and strict per-method input/auth policy.
3. D1 schema and repository, sessions/authentication, transactional posting correctness.
4. No source file changes to `Mohim_ERP` and no live database writes.

This is a deliberately inert migration preview: it shows the interface but does not claim to run ERP transactions.
