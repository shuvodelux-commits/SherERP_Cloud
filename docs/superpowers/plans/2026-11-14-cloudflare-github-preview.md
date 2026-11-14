# Cloudflare Preview via GitHub Actions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:verification-before-completion, implement each safe slice with tests. Checkboxes track progress.

**Goal:** Prepare the existing Cloudflare Workers Static Assets shell for **manual GitHub Actions preview deployment only**, with no production deploy, real D1 resources or original ERP writes.

**Architecture:** GitHub Actions validates the pinned source and original HTML build without Cloudflare credentials. A separate workflow_dispatch job deploys only a distinct Worker named `shererp-cloud-preview`, gated by a GitHub environment and narrowly scoped Cloudflare API credentials. Keep the ordinary production `wrangler.jsonc` untouched. Do not turn on Cloudflare native Workers Builds at the same time as this external deployment pipeline.

**Tech Stack:** Node.js 22, npm, GitHub Actions, `cloudflare/wrangler-action@v4`, Wrangler 4.161.0, Cloudflare Workers Static Assets (no D1 binding in preview).

**Spec:** `docs/CLOUDFLARE_GITHUB_SETUP.md`; `docs/MIGRATION_PLAN.md` and `AGENTS.md` on the parent branch.

## Global constraints

- Original `Mohim_ERP`, live GAS, Sheets, and production D1 remain unchanged.
- The original HTML/CSS/JS remains byte-identical under `legacy/source`, assembled via `npm run build:frontend`.
- Current Worker API fails closed for all business RPC methods, with no DB connection.
- Cloudflare preview Worker name is `shererp-cloud-preview`, NEVER `shererp-cloud`.
- No preview database_id, no D1 binding, no environment secrets checked into repo.
- Deployments are never run on PR events or pushes. Preview deploy requires an explicit GitHub Actions manual trigger on `main`, after the config is merged, and an approved `cloudflare-preview` environment.
- Creating any external Cloudflare account token, connecting GitHub/Cloudflare identities, or enabling deployment requires the owner's action. Do not claim an authenticated connection before a real deployment succeeds.

## Review focus

- Workflow must not expose Cloudflare secrets to PRs/forks.
- Wrong Worker target/name or D1 binding must fail before Cloudflare deployment.
- `wrangler deploy --dry-run` CI must never publish or request production credentials.
- A manual dispatch from another branch must not reach deployment.
- Existing Worker/static asset functionality and original UI must not change as a side effect.

---

### Task 1: Preview configuration safety checks

**Files:** Create `wrangler.preview.jsonc`, `scripts/check-cloudflare-preview.mjs`, `tests/check-cloudflare-preview.test.mjs`.

- [ ] RED: tests expect `validateCloudflarePreviewConfig(config)` to accept a distinct asset-only preview Worker and reject production Worker name, D1 binding, routes, and missing API-first routing.
- [ ] GREEN: implement explicit fail-closed config validation without parsing untrusted JS.
- [ ] Run `node --test tests/check-cloudflare-preview.test.mjs`; confirm pass.
- [ ] Run against committed `wrangler.preview.jsonc`; confirm exit 0.

### Task 2: GitHub Actions preview CI and manual deploy

**Files:** Create `.github/workflows/cloudflare-preview.yml`, update `package.json` if needed.

- [ ] Add `pull_request` test/build/preview-config/dry-run job, with `contents: read` only and no secrets.
- [ ] Add manual `workflow_dispatch` job, strictly `refs/heads/main`, with `environment: cloudflare-preview`, secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; deploy preview only.
- [ ] Ensure the actual deploy job depends on successful validation, without rerouting to production config.
- [ ] Pin Wrangler version, validate GitHub workflow syntax and positive/negative test cases, then open draft PR.
- [ ] Verify GitHub Actions runs; do not claim Cloudflare is connected or Worker deployed.

### Task 3: Owner onboarding and release gates

**Files:** Create `docs/CLOUDFLARE_GITHUB_SETUP.md`.

- [ ] Provide exact GitHub Actions Environment steps and Cloudflare least-privilege account token setup, with no tokens in chat/commit.
- [ ] Explain PR merge dependencies: main is not ready for deployment until foundation Worker shell is merged.
- [ ] Show how to trigger preview manually and verify `/api/health`, which must report database not-connected and all ERP RPC calls disabled.
- [ ] Document D1 as a separately approved migration/reconciliation gate; no remote migrations in this workflow.
- [ ] Production deployment remains a separate later PR plus explicit approval.
