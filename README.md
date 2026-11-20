# SherERP Cloud

Migration workspace for the existing [Mohim_ERP](https://github.com/shuvodelux-commits/Mohim_ERP), preserving the HTML/CSS/vanilla JavaScript frontend and original ERP business/accounting rules while moving from Google Apps Script + Google Sheets to **Cloudflare Workers + Cloudflare D1 (SQLite)**.

> **Current status (2026-11-20): MVP integration in progress; production NO-GO.** Read the dated [central project status, handoff and task board](PROJECT.md) first. The public Worker/RPC shell remains intentionally non-transactional and D1-free; internal real local Workerd/D1 integration proofs do not authorize live business posting, remote data import or cutover. The original repository and Google Sheets remain untouched.

## Read first

- **[PROJECT.md](PROJECT.md)** — **single current status, handoff and prioritized task board**. Refresh its dated GitHub snapshot before using it to decide readiness.

- **[Master migration plan](docs/MIGRATION_PLAN.md)** — architecture, source inventory, phased implementation (M00–M11), acceptance tests, security, reconciliation and rollback.
- **[Workstream register](docs/WORKSTREAMS.md)** — specific deliverables, dependency graph, high-risk spikes and PR acceptance matrix.
- **[AGENTS.md](AGENTS.md)** — instructions for coding agents: preserve existing UI/business logic, forbid unsafe financial transactions, require real D1 integration tests.
- **[Automatic Cloudflare Builds and PR previews](docs/CLOUDFLARE_GITHUB_SETUP.md)** — `main` auto-deploys the DB-free shell; non-main branches receive isolated Preview URLs. No GitHub Actions deploy job.
- **[Approved unified Party architecture](docs/architecture/ADR-007-unified-party-relationships.md)** — one identity, Customer/Supplier/Vendor/Owner/Lender/Borrower/Payee roles, separate accounts and opt-in authorized manual offsets.
- **[Party design](docs/superpowers/specs/2026-11-14-unified-party-design.md)** and **[test-first implementation roadmap](docs/superpowers/plans/2026-11-14-unified-party-migration.md)** — dependencies and release blockers before Party/finance D1 implementation.

## Architecture target

    Existing HTML/CSS/JS frontend
               |
        Cloudflare Worker
        /api/rpc allowlist
               |
     Existing ported JavaScript logic
               |
        Async D1 repository
               |
      Cloudflare D1 / SQLite

### Principles

1. No frontend redesign or unrequested framework conversion.
2. Source business rules, FIFO lots, returns, deletes and accounting are the source of truth.
3. Renaming .gs to .js is only the beginning: Google services, async database calls and transaction boundaries also need porting.
4. D1 batch atomicity plus SQL-level conflict guards and idempotency are mandatory for money/stock changes.
5. No secrets or real business dataset committed to this repository.
6. No production deployment or change to legacy GAS/Sheets until reconciliation and cutover gates pass.
7. **Approved Party policy:** One Party can have seven roles; gross AR/AP/advances/vendor/loan/equity positions stay separate. No auto-merging by name/phone, no auto-netting, and pure approved manual offsets never move cash/bank.
8. Remaining Party/finance schemas are blocked on reviewed M02-P Party identity, role, account and legacy-link contracts; manual cross-role settlement stays off until M08-S financial and authorization tests are approved.

**Implementation order:** M00 baseline -> M01 Worker shell / M02 schema inventory -> **M02-P Party architecture and reviewed mapping** before related remaining financial schemas -> M03 async runtime -> M04 auth -> M05 inventory -> M06 POS -> M07/M08 corrections + finance -> M09 reports/Party workspace -> M10 rehearsal -> M11 cutover. **M08-S** optional manual settlement remains separately gated.
