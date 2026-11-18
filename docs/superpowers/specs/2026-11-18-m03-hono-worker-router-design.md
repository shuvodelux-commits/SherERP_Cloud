# M03 Hono Worker routing design

The Cloudflare Worker uses Hono to match HTTP routes. Existing static assets, RPC handlers, and the response shapes stay in place. Hono does not supply an authentication adapter or a D1 binding for public previews.

- `src/http/app.js` defines the exact health and RPC paths, the API 404 response, and the static asset fallback. It passes the original Request to RPC and static assets. A custom path reader preserves the previous URL pathname behavior for encoded paths.
- `src/index.js` exports the Hono app as the Worker entry point. The separate staging Worker can continue calling it for the assets it already delegates.
- `tests/worker-router.test.mjs` covers routing, fail-closed RPC, and raw Request forwarding, including HEAD. The Google route stays unavailable until M04 integrates an approved authentication and session path.

The frontend remains the pinned SherERP HTML, CSS and JavaScript. This change adds no database schema, auth provider, business RPC, or release configuration. The PR stacks after #642 because both updates touch the package manifest and lockfile.
