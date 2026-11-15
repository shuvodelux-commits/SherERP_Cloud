# M08 — Finance Person directory read model (source parity)

**2026-11-15. Workstream:** M08 / #66. **Source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `legacy/source/FinanceModule.gs` (`financeCanonicalRoles_`, `financePersonRoles_`, `getAllFinancePersonsForUI_`, `getActiveFinancePersonsForUI_`). **Depends on:** merged #100 independent finance role balances and #111 finance ledger chronology.

## Motivation and choice
The original Finance Person master has *one immutable source Person ID* and additive `Roles` representing any combination of Owner, Lender and Borrower. It uses canonical role order, accepts a legacy `Person Type` fallback when `Roles` is blank/unsupported, and defaults to Owner only if both have no recognized role. The list includes Active and Inactive entries; its active-only view excludes `Inactive` and preserves selected fields. A port must not turn a multi-role person into three masters or fold finance master records into Customer/Supplier Party data by shared names.

Alternatives: (a) public RPC or D1 Party master projection now: rejected because reviewed M02-P identity/role account import and M04 authorized APIs remain gated; (b) link on name/mobile: rejected by ADR-007; (c) **chosen:** a pure internal `projectFinancePersonDirectory(rows,{activeOnly=false}={})` consuming preloaded source-shaped Finance Person rows. The original GAS functions run in synthetic test-only VM as exact oracle; there is no source copying to production. Return list with the source's two precise shapes. No SQL, staff actor or finance write.

## Source contract
- `all`: `{id,name,type,roles,status,phone,description}` in original row order, with `Status || 'Active'`, `Person Type || roles[0] || 'Owner'`, `Description || Notes || ''`, `Phone || ''`.
- `activeOnly`: filter only records whose computed status is `'Inactive'` *exactly*, then omit `status`; `{id,name,type,roles,phone,description}`. No artificial sorting or deduplication.
- Canonical roles `['Owner','Lender','Borrower']` ordered exactly, ignoring unknown tokens and duplicates. Nonempty recognized `Roles` wins over legacy `Person Type`; empty/unknown `Roles` falls back to recognized legacy type; fallback last to `Owner`. Source supports comma-delimited strings and role arrays.
- Original `Person ID` identifies a row, **not** name or phone. Two people with the same name/phone but distinct IDs remain distinct, and one source person may have three roles yet is represented once. Role membership is data, not permission or proof of a linked Party.
- Defensive restriction vs original GAS: reject null/Promise/non-array rows, missing/non-string/blank IDs, duplicate source IDs, and missing/non-string/blank names **before** any projection; no partial listing or guessed IDs. Source has historically allowed blank IDs/names, but displaying identity-ambiguous records as authoritative would be unsafe; quarantine such records for reviewed import. Other optional fields preserve GAS `||` behavior exactly for validated rows.
- Do not infer balances from roles, status, display names or phones. This module does not accept transaction history. Previous finance balances remain separate read models.

## Tests / dependencies / boundaries
Tests execute original pinned `FinanceModule.gs` function declarations with original `FINANCE_PERSON_ROLES` via existing `tests/fixtures/m08-legacy-source-runner.mjs`, and compare source oracle output on eligible synthetic records with independent assertions for active filtering, canonical role order, fallback behavior, same-name distinct IDs, no mutations, metadata and invalid inputs. **No new dependency**. Exactly four files: source module `src/modules/m08-finance-person-directory.js`, test `tests/m08-finance-person-directory.test.mjs`, this spec and plan.

**File/RPC/table impact:** M08-owned pure module only; no Worker route, SQL D1 read/write, migrations, tenant auth, UI, original source, Cloudflare Preview change or remote D1 operation. Real M08 finance posting and M08-S settlement remain disabled. Source VM/unit parity is **not** Worker/D1 transaction-atomicity or account reconciliation proof. Rollback: revert four-file PR.
