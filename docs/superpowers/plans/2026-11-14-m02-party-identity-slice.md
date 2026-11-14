# M02-P0/P1 Party Identity Foundation — Superpowers Execution Record

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve source-faithful identity and role relationships while preparing a safe Party identity schema in D1, without touching money or production data.

**Architecture:** First verify the five original Party source master contracts from Config.gs. Then add four STRICT identity tables, SQL guards and real SQLite tests proving no automatic source-ID merge. Financial accounts, importer and manual settlement remain separate gated phases.

**Tech Stack:** Node.js 22, Node `node:test` + `node:sqlite`, SQLite STRICT SQL compatible with D1 migrations, GitHub Actions; real Wrangler-backed D1 tests remain an explicit follow-up.

**Spec:** [Approved ADR-007 and its implementation plan in PR #7](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/7).

## Global Constraints

- Source SHA `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
- All seven descriptive Party roles can coexist but never confer staff permissions.
- Preserve original Customer/Supplier/Vendor/Finance Person/Expense Payee IDs, and do not merge by name or phone.
- Vendor Due/Receivable, Customer/Supplier advances, Owner equity and Lender/Borrower loans remain separate; Payee is not an automatic payable.
- Original Sheets, GAS and production D1 resources are untouched.
- No automatic netting, financial tables, cash movements or settlement RPCs in this slice.

## Review Focus

- Same number/name across unrelated source masters: no automatic linkage.
- Legacy Finance Person with three roles: all roles survive; no new staff RBAC.
- Existing historical source link: duplicate or reassignment rejected.
- Inactive Party role: historical membership preserved, not deleted.
- Missing original source ID: review record only, not forced Party linkage.

---

### Task 1 — Legacy source contract inventory (M02-P0)

**Files:**
- Create: `src/party/legacy-contracts.js`
- Create: `tests/contract/party-contract.test.mjs`
- Create: `tests/fixtures/party-inventory.synthetic.json`
- Create: `docs/baseline/party-contract-inventory.md`

**Interfaces:** `partyLegacyContracts`, `rolesForLegacyRow(group,row)`, `validatePartyContracts(inventory)`.

- [x] Test written first: five source groups and their ID/name/phone/balance headers plus finance-role legacy fallback.
- [x] Observed RED because `legacy-contracts.js` did not exist.
- [x] Implemented literal source metadata and conservative role adapter.
- [x] Observed GREEN on three targeted Node tests.
- [x] Added GitHub CI check against the **full frozen 49-group source inventory**, not just synthetic headers.
- [x] Added explicit source mapping and accounting cautions in documentation.

### Task 2 — D1 identity schema (M02-P1, narrow SQL slice)

**Files:**
- Create: `migrations/0002_party_identity.sql`
- Create: `tests/integration/party-schema.test.mjs`

**Interfaces:** `parties`, `party_roles`, `party_legacy_links`, `party_identity_review` with explicit statuses, role whitelist, FK guards and immutable original-source links.

- [x] Wrote SQLite tests first; observed RED because migration file did not exist.
- [x] Added STRICT tables; tests rejected same-name/phone uniqueness and verified seven roles.
- [x] Tests exposed role-history deletion allowance; observed second RED, then added trigger to require deactivation rather than hard-delete.
- [x] Verified original-source link uniqueness, second-source human verification with reviewer/date, no silent reassignment or hard-delete.
- [x] Verified review queue does not create an identity link.
- [x] Full local Node suite: **27 tests passed / 0 failed**.
- [x] Five implementation/test/fixture Git blob hashes match exact locally tested files.
- [ ] GitHub Actions verification on the new PR.
- [ ] Real Wrangler-backed local D1 integration test: outstanding before claiming M02-P1 fully complete.

### Task 3 — Explicitly deferred, not silently implemented

- [ ] Deterministic no-write Party identity import dry run with ambiguous-source review (M02-P2).
- [ ] Party accounts/subaccounts with signed receivable/payable/advance/equity/loan reconciliation.
- [ ] Original customer/supplier/vendor/finance/expense RPC adapters and staff authorization.
- [ ] Manual noncash settlement only after reviewed eligibility, approvals and atomic ledger contract.
- [ ] Actual local D1 and browser integration tests, staging data reconciliation and cutover.

## Rulings

- **Legacy schema scope:** SQL identity tables are independent of financial accounts. The staged catalog `0001` migration is not changed.
- **Historical protection:** Identity links and roles are never physically deleted by the first schema; future corrections require separately audited procedures.
- **No real D1 claim:** The current tests execute SQLite using Node's built-in database engine. Cloudflare D1 migration/runtime must still be demonstrated before a final M02 exit.
- **Stacked PRs:** This implementation sits after M02 catalog PR #6 and depends on owner-approved Party ADR PR #7. Neither is presumed merged based only on user status.

## Verification commands

```bash
npm test
node --test tests/contract/party-contract.test.mjs tests/integration/party-schema.test.mjs
node --input-type=module -e "import {readFileSync} from 'node:fs'; import {validatePartyContracts} from './src/party/legacy-contracts.js'; validatePartyContracts(JSON.parse(readFileSync('docs/baseline/schema-inventory.json','utf8')))"
```

Do not merge this PR as a complete migration or treat local SQLite alone as real D1 integration evidence.
