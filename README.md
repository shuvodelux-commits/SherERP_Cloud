# SherERP Cloud

Migration workspace for the existing [Mohim_ERP](https://github.com/shuvodelux-commits/Mohim_ERP), preserving the HTML/CSS/vanilla JavaScript frontend and original ERP business/accounting rules while moving from Google Apps Script + Google Sheets to **Cloudflare Workers + Cloudflare D1 (SQLite)**.

> **Current status: Planning only.** The application has not yet been ported, deployed or cut over. The original repository and Google Sheets remain untouched.

## Read first

- **[Master migration plan](docs/MIGRATION_PLAN.md)** — architecture, source inventory, phased implementation (M00–M11), acceptance tests, security, reconciliation and rollback.
- **[Workstream register](docs/WORKSTREAMS.md)** — specific deliverables, dependency graph, high-risk spikes and PR acceptance matrix.
- **[AGENTS.md](AGENTS.md)** — instructions for coding agents: preserve existing UI/business logic, forbid unsafe financial transactions, require real D1 integration tests.

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

**Implementation order:** M00 baseline -> M01/M02 frontend + schema -> M03 runtime + D1 -> M04 auth -> M05 inventory -> M06 POS -> M07/M08 corrections + finance -> M09 reports -> M10 staging rehearsal -> M11 cutover.
