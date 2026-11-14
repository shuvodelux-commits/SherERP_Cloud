# Native Cloudflare Workers Builds — Automated PR Previews

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans, superpowers:test-driven-development, superpowers:verification-before-completion.

**Goal:** Cloudflare automatically generates a preview URL for non-`main` commits/PRs, and deploys the reviewed `main` version without any GitHub Actions deploy job.

**Scope:** Existing inert `shererp-cloud-preview` Worker. Not production ERP cutover, not public D1, not a migration trigger.

## Planned and verified changes

- [x] Preserve `wrangler.preview.jsonc` Worker name, `ASSETS`, worker-first routing and DB-free design.
- [x] Declare an explicit empty `previews` block to avoid importing mutable resources.
- [x] Update config safety guards to allow **only** an empty preview resource block; keep staging D1 separate.
- [x] Update Node tests for these new invariants.
- [x] Replace the legacy manual GitHub Actions Worker deployment job with PR-only, credentials-free validation; add tests asserting no duplicate deploy.
- [x] Align README, AGENTS and Cloudflare setup guide with Cloudflare Workers Builds as sole deployment owner.
- [ ] Verify GitHub CI on this branch and the Wrangler dry-run of config.
- [ ] **Owner action:** Cloudflare Settings → Builds → Branch control → Enable Preview Builds ON; select `main`.
- [ ] **Owner action:** Cloudflare Build/Deploy/Preview commands: `npm run build:frontend`; `npx wrangler@4.161.0 deploy --config wrangler.preview.jsonc`; `npx wrangler@4.161.0 preview --config wrangler.preview.jsonc`.
- [ ] Create harmless PR and verify Cloudflare's actual Preview URL and GitHub comment.
- [ ] Merge reviewed PR; verify Cloudflare's `main` branch deployment.

**Safety:** No D1 or real business data in preview or main Worker; leave manual staging database migration control independent.
