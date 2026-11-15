# M09 authorized Invoice Design Settings read — no-logo safe phase

**Date:** 2026-11-15. **Source authority:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` frozen `Settings.gs::getInvoiceDesignBootstrap`, `Database.gs::getSettingsMap_`, `Invoice.gs::resolveInvoiceLogoDataUri_` and original `invoiceDesign.html`.

## Scope and critical invariants

The existing `src/modules/settings-invoice-bootstrap-read.js::projectInvoiceDesignBootstrap` preserves original `{settings,logoDataUri}`, but the application still needs an authenticated internal D1 source. Reuse `src/db/m04-settings-view.js::createM04AuthorizedShellSettingsReadAdapter(env).getSettingsMap_(request)`: **single fixed D1 SELECT with current-session + role/epoch `settings.view` in the same SQL statement**. This avoids the unsafe preflight-then-unprotected-read race. Its existing M04 schema has **no tenant_id** and is only approved for an **isolated single-business test D1**, not shared-tenant production or public preview.

Create pure orchestrator `createM09AuthorizedInvoiceDesignD1Reader(env)`, exposing only `async getBootstrap(request)` as an **internal** reader. Use the exact source-shaped full Settings map, not the two-key Reports/Shell Settings API; no global session cache, fallback permissions, product pricing changes or UI rewrite. The caller's M04 request must be an own-data `{token,nowMs}` and use validated M04 adapter permissions. Do not store, log or return the bearer.

**Logo storage is NOT migrated.** The source Settings `Invoice Logo` value is a Google Drive File ID. In this phase an **empty** / missing logo ID yields source-equivalent `logoDataUri:''`; any **non-empty** logo ID causes a generic `NEEDS_REVIEW: Invoice logo asset migration is not available` failure, **not** a successful response with missing artwork, a fake data URI, external URL, Drive call, or discarded setting. The complete original Settings map must be preserved for authorized clients, including numeric-looking strings (D1 text values), without exposing it to callers with only `reports:view` or `settings:edit`.

Run real isolated local Workerd/D1 tests against source-pinned Settings table and M04 auth migrations: Administrator and active view-only can read, edit-only/anonymous/expired/revoked/role epoch stale cannot read, logo gate fails without leaking file IDs, no authorization-before-I/O shortcut, no Settings mutation, private full Settings never appears in public Worker routes. Test UTF-8/Bangla data and exact response field/key order. Leave M04 auth code, shared source/Settings schema, `src/rpc/registry.js`, original source UI, production Worker and Cloudflare bindings unchanged. This is **not** M09 completion or permission to deploy a live ERP.

## GitHub-first Superpowers plan and files

Six new scoped files only: spec, plan, Node TDD source/auth tests, implementation module, real Workerd/D1 integration tests, dedicated PR-only/no-secrets CI workflow. Use an **isolated** test harness, do not change shared `m03-workerd.spec.mjs` (concurrent PR #224 owns it). First commit tests + CI + spec/plan; observe expected missing-module RED on GitHub; then minimal GREEN and exact-head green source/Worker, M04, M01, Workerd/D1 and Cloudflare PR preview.

**Rollback:** revert six added files. No D1 schema/data/money writes or production changes. Live Settings/Invoice Design route remains gated by M04 tenant enforcement, M03 source mapping, approved logo-object-storage migration, and owner cutover.
