# M01 — Single-flight keyboard sign-in while request is pending

> Superpowers: read GitHub source → plan → test-first observed RED → minimal GREEN → exact-head GitHub Actions → owner PR review.

**Goal:** Ensure rapid repeated Enter on the original sign-in input cannot submit concurrent duplicate login RPCs while the first request is unresolved. Preserve one intentional retry after the first request finishes.

**Source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; `AGENTS.md`, `docs/MIGRATION_PLAN.md` P1, `docs/WORKSTREAMS.md` M01. Original `javascript.html::doLogin_` disables the Login button when pending but its Enter key handler still invokes `doLogin_` without checking pending state. The original GAS source and production Sheets must remain untouched.

**Architecture:** Retain identical source HTML/JS/CSS on disk. Make one mechanical, fail-closed substitution **only in compiled output** inside `scripts/patch-rpc.mjs::patchServerCall`: after the legacy `doLogin_` obtains the existing Login button, return early when the button is disabled. Reuse the existing pending lifecycle so the button re-enables after completion. No framework, no unrelated login/auth adapter, no new runtime dependencies.

## Test first — RED
1. Extend `qa/m01-browser.spec.mjs` using real Chromium, compiled original UI, local inert Worker fixture. Intercept `login` requests only in the test page and intentionally hold their responses, with synthetic credentials.
2. Press Enter once, wait until first request is in flight; press Enter twice more while button is disabled and assert **exactly one request** exists. Expect test failure on original unguarded code.
3. Release the response as the same controlled login 503, confirm login overlay remains, token absent, busy state resets, and a **new intentional Enter retry** sends a second request.
4. Extend `tests/rpc-patch.test.mjs` with a synthetic frozen login function marker and require one exact pending guard in generated output; test should fail before implementation.
5. Commit tests first, capture failing GitHub Foundation / M01 Chromium CI as RED.

## Minimal GREEN
1. Edit only `scripts/patch-rpc.mjs` to inject `if (btn && btn.disabled) return;` immediately after the existing `var btn = document.getElementById('loginSubmitBtn');` in the original `doLogin_`. Preserve all surrounding JS, style, navigation and GAS source bytes.
2. Fail closed on duplicate login-function markers. Minimal synthetic RPC fixtures without a login function remain supported; the browser and synthetic-unit tests verify presence when actual original login exists.
3. Verify Chromium baseline login/print/mobile, new pending and retry test, full Node suite, frozen-source manifest and frontend build. Check original public auth still 503.
4. Record exact-head CI, review small diff, update draft PR. Owner review and merge only.

## Boundaries
No production public auth activation, M04 permissions, D1 binding or migrations, financial/stock/Party data, real credentials, public RPC registry, Worker config, source legacy HTML/JS/CSS changes or redesign. Only existing generated-output transport/guard patcher, M01 unit/browser tests and this plan. The login UI remains unchanged; this only blocks duplicate pending requests.

## Review
Source-locked marker exactness; one-request assertion during pending state; intentional retry still works; default public backend still rejects sign-in safely; no data leak or local/remote D1 impact. Integrated real login and full Day Book transaction reads remain separate blockers.
