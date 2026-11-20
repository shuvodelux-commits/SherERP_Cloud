# ADR-008 — Approved HisabIQ Party UI parity for SherERP (execution handoff)

**Decision:** OWNER APPROVED on 2026-11-21 (Asia/Dhaka).
**Backend authority:** [ADR-007](ADR-007-unified-party-relationships.md) remains binding; this document does not change its accounting rules.
**Frontend design authority:** [shuvodelux-commits/hisabiq_ui](https://github.com/shuvodelux-commits/hisabiq_ui/tree/e42a00a9f48ffc1f5c4ec10083e36d9eb4686484), exact source commit `e42a00a9f48ffc1f5c4ec10083e36d9eb4686484` (2026-11-19).
**Target:** [shuvodelux-commits/SherERP_Cloud](https://github.com/shuvodelux-commits/SherERP_Cloud), existing Owner ERP authenticated Shop UI.
**Priority:** production MVP. **Status:** approved design/implementation contract; no implication that the hosted UI, D1 accounts or postings are implemented by this document.
**Workstreams:** M01/M09 (frontend parity), M02-P (identity/source mapping), M03 (exclusive shared D1/Worker/SQL integration), M04 (authorization), M08 (gross role-account ledgers), M10/M11 (verification/release).
**Coordination:** [MVP #690](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/690), [M08 #66](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/66), [M02 #24](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/24), [parallel coordinator #456](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/456). Do not open duplicate generic readiness issues.

## Implementation overview (12-sentence module handoff)

1. The Owner-approved backend uses one immutable Party identity with any combination of Customer, Supplier, Vendor, Owner, Lender, Borrower and Payee roles.
2. All financial amounts remain in independent role/account/contract ledgers, and no Party-wide net balance authorizes a posting.
3. The Owner-approved frontend is the **existing HisabIQ UI Party module**, not a newly invented Party screen.
4. Preserve its desktop directory/detail layout, adaptive tablet/mobile screens, bilingual copy, compact visual language, keyboard/touch affordances and Party editor.
5. Preserve its relationship selector, per-role gross balance cards, chronological ledger, source links, date filters, statement/export/print, dialogs and contextual actions where the backed capability is genuinely implemented.
6. A person already listed as Customer must gain Supplier or Lender or another role **on the same Party ID**, not silently receive a duplicate identity.
7. New Party creation must search potential matches but never merge solely by name, phone, nickname or shared contact details.
8. The existing SherERP source Customer/Supplier/Vendor/Finance identifiers and posted history remain stable behind reviewed Party links and compatibility adapters.
9. Authenticated Shop D1 is the only real business data source; never ship HisabIQ demo/preview arrays, local-only success toasts or mock ledger balances as production truth.
10. Every financial action must route to an approved source-owned Worker API with current server-side authorization, cash-session/tenant rules, atomicity, idempotency, reversal and exact reconciliation.
11. Purely historical opening balances must not post current-day Cash Book/Bank Book activity, and manual cross-role offsets remain disabled pending separate M08-S approval.
12. M01/M09 can build UI-only parity in isolated files, while the exclusive M03 integrator owns shared Worker, D1 migrations and posting connections; CI and real browser+D1 tests are required before production release.

## Exact UI source mapping (reuse rather than redesign)

| Surface | Pinned HisabIQ source path | Required parity |
| --- | --- | --- |
| Page/router and desktop split | [src/pages/Parties.tsx](https://github.com/shuvodelux-commits/hisabiq_ui/blob/e42a00a9f48ffc1f5c4ec10083e36d9eb4686484/src/pages/Parties.tsx) | `Parties & Ledger`, gross directory receivable/payable summary, Add/Import, selected Party by `?id=&role=`, 340–380px directory and fluid detail panel at desktop width |
| Desktop directory | [src/components/parties/PartyDirectory.tsx](https://github.com/shuvodelux-commits/hisabiq_ui/blob/e42a00a9f48ffc1f5c4ec10083e36d9eb4686484/src/components/parties/PartyDirectory.tsx) | Search name/Bangla name/phone, seven relationship chips plus All, active selection, compact avatar/role badges, arrow-key/Enter navigation, no false combined amount when multiple roles |
| Tablet/phone directory | [src/components/parties/PartyDirectoryResponsive.tsx](https://github.com/shuvodelux-commits/hisabiq_ui/blob/e42a00a9f48ffc1f5c4ec10083e36d9eb4686484/src/components/parties/PartyDirectoryResponsive.tsx), [PartyActionSheet.tsx](https://github.com/shuvodelux-commits/hisabiq_ui/blob/e42a00a9f48ffc1f5c4ec10083e36d9eb4686484/src/components/parties/PartyActionSheet.tsx) | Keyboard/touch picker; right sheet on tablet, bottom sheet on phone, responsive role-chip scrolling, no side panel forced on 375px |
| Selected Party | [PartyDetail.tsx](https://github.com/shuvodelux-commits/hisabiq_ui/blob/e42a00a9f48ffc1f5c4ec10083e36d9eb4686484/src/components/parties/PartyDetail.tsx), [PartyDetailAdaptive.tsx](https://github.com/shuvodelux-commits/hisabiq_ui/blob/e42a00a9f48ffc1f5c4ec10083e36d9eb4686484/src/components/parties/PartyDetailAdaptive.tsx), [PartyDetailResponsive.tsx](https://github.com/shuvodelux-commits/hisabiq_ui/blob/e42a00a9f48ffc1f5c4ec10083e36d9eb4686484/src/components/parties/PartyDetailResponsive.tsx) | Avatar/contact/Bangla name/status, edit, relationship selection, context actions and 5 content tabs: Ledger, Invoices/Purchases, Payments, Notes, Attachments; adaptive layout at 1024px; independent Vendor payable vs receivable |
| Create/edit and multi-role assignment | [PartyEditorDialog.tsx](https://github.com/shuvodelux-commits/hisabiq_ui/blob/e42a00a9f48ffc1f5c4ec10083e36d9eb4686484/src/components/parties/PartyEditorDialog.tsx) | Name, Bangla name, phone, address, multi-role checkboxes, optional separate opening per role, side/date, editing an existing Party without rekeying |
| Ledger/display | [LedgerTable.tsx](https://github.com/shuvodelux-commits/hisabiq_ui/blob/e42a00a9f48ffc1f5c4ec10083e36d9eb4686484/src/components/parties/LedgerTable.tsx), [LedgerTableResponsive.tsx](https://github.com/shuvodelux-commits/hisabiq_ui/blob/e42a00a9f48ffc1f5c4ec10083e36d9eb4686484/src/components/parties/LedgerTableResponsive.tsx), [PartyLedgerToolbar.tsx](https://github.com/shuvodelux-commits/hisabiq_ui/blob/e42a00a9f48ffc1f5c4ec10083e36d9eb4686484/src/components/parties/PartyLedgerToolbar.tsx) | Source-linked rows, correct signed running balance over full filtered history rather than current page, date/ref/type filters, row context menu, compact desktop table, stacked mobile cards |
| Source actions and reporting | `src/components/parties/Party{Payment,CreditRefund,Finance,Opening,Statement,Transaction}Dialog.tsx`, `src/utils/partyLedger.ts` | Connect only to audited source-owned endpoints; preserve source references, audit/reversals and print/CSV contract; unsupported operations show explicit unavailable state |
| Style and bilingual behavior | `src/i18n/party*.ts`, `src/components/parties/RoleBadge.tsx`, `src/components/PartyAvatar.tsx`, `DESIGN.md` | Ink/teal, Geist/Hind Siliguri, compact cards/tables, native number alignment without monospaced digits, EN/BN labels and phone-first touch readability |

**Important source caveat:** HisabIQ `src/pages/Parties.tsx` currently calls `dispatchPartyPreview` and `availableParties`; payment, finance, opening, import and note actions can mutate preview state and display preview-only success toasts. Copying those data sources into hosted SherERP would be incorrect. Keep the UI appearance and interactions, **replace the data/controller layer** with an authenticated Shop-scoped service adapter; no fake persistence or balances.

**Platform caveat:** SherERP currently uses its existing original HTML/JS Owner shell (including `legacy/source/customers.html`, `suppliers.html`, `customerLedger.html`, `supplierLedger.html`, `finance.html`, and `scripts/build-owner-frontend.mjs`), whereas HisabIQ UI is React/Vite. Choose an isolated Party-only integration boundary or faithful component port that is compatible with existing Owner hosting/build; **do not replace the entire ERP shell, POS, navigation or non-Party pages**, and do not bundle the demo app into production.

## Binding backend/accounting contract

- Reuse `migrations/0002_party_identity.sql`: `parties`, `party_roles`, `party_legacy_links`, `party_identity_review`. Keep seven roles and immutable historical source links.
- Provide a reviewed operational **Party CRUD/attach-role** API on authenticated same-origin Owner Shop service. It must resolve the signed-in Shop and actor from trusted sessions, use an immutable `partyId`, and validate role transitions and linked histories. A create-or-select workflow must not infer identity by name/phone or allow arbitrary client-supplied Shop IDs.
- The existing `staging-migrations/shop-owner-write/0005_owner_supplier_master.sql` creates a new Party on Supplier create and uniquely indexes active name. Before attaching Supplier to an existing Party, M03 must design a safe extension of the **one** source ID issuer and SQL guards. Do not simply disable constraints or split the Supplier due from its authoritative legacy reference.
- Preserve selected original `Customer ID` in POS/drafts and original `Supplier ID` in purchases/payments; attach both to an authorized `partyId` only through reviewed links. Any new role-specific ID remains stable.
- Keep independent gross amounts for Customer AR/customer credit, Supplier AP/supplier advance, Vendor AP/AR, Owner equity/drawings, Lender loan AP per agreement, Borrower loan AR per agreement. Payee is an identity without automatic payable.
- Do **not** introduce a second authoritative posting engine merely to show unified Party ledgers; prefer a read-only projection/compatibility layer over the already accepted source-ledger writers until one reconciled journal cutover is explicitly approved.
- Ledger statement invariant: `opening before from + in-range debit - in-range credit = closing` after mapping the **role-specific original source direction**. No fabricated netting, invisible deletion effects or page-only running balances.
- Historical signed openings and loan openings remain baseline records: no current Cash Session requirement solely for recording historical opening, and zero same-day Cash/Bank turnover. Current real cash in/out, supplier pay and expenses must count in the live cash session whenever configured.
- Cross-role settlement remains disabled and absent from action menus until a separately approved M08-S ledger/permission/legal policy, test-backed reversal and atomic noncash posting is released.
- Cash sale without a selected Party remains allowed under original POS rules.

## Suggested minimal API integration contract (to review, not a live API assertion)

- `GET /api/owner/parties?role=&q=&cursor=`: scoped directory; gross balance summary and unique Party identity; stable pagination.
- `POST /api/owner/parties`: idempotent create or explicit reviewed match link; assign any subset of seven roles, **no financial opening within an unapproved Party creation writer**.
- `GET /api/owner/parties/:partyId`: profile, roles, independent gross role/account balances, active/inactive state and distinct legacy source references.
- `PATCH /api/owner/parties/:partyId`: editable contact and role association with audit; no deletion/renaming of posted source IDs.
- `GET /api/owner/parties/:partyId/ledger?role=&from=&to=&cursor=`: one selected role/contract, verified closing/checkpoint, immutable source references and permission-aware pagination.
- `POST` for receipts, payments, openings, loans, corrections and returns must be the **existing approved domain-specific operations** as connected by M03/M08, not new unconstrained generic Party money endpoints.

M03 must version and freeze the real contracts with M01/M09 and M08 before implementation. **None of these example routes should be claimed present today.**

## Acceptance checklist (required evidence)

- [ ] Baseline HisabIQ UI source SHA pinned; exact component-level layout/interaction inventory and current SherERP source ownership checked before code.
- [ ] Source-only Party UI port/design parity screenshots at desktop 1440px and 1024px, tablet 768px, phones 390px and 320/375px, light/dark, bilingual, no clipped numbers/dialogs, keyboard focus and proper touch controls.
- [ ] On one Shop, create Customer Rahim, edit contact, attach Supplier and Lender to **same Party**, reopen browser and verify one immutable Party with three distinct source IDs/accounts.
- [ ] A different Rahim with same name/phone stays separate; ambiguity prompts for manual resolution; no automatic merge; cross-Shop request denied.
- [ ] Directory role filters, selected relationship query URL, role-specific gross balance, Vendor dual gross accounts, per-role chronological statement/CSV/print match original source.
- [ ] Customer sale due/receipt and Supplier purchase due/payment remain separate and reconcile to their source invoice/purchase references; no offset when roles are added.
- [ ] Owner investment, lender loan and borrower loan are never combined into a generic due; Payee creates no debt; contract-level loan details preserved.
- [ ] Historical opening is auditable with correct sign, no current Cash/Bank/Sessions movement; current cash in/out includes all legitimate session movements.
- [ ] No preview-only backend labels/data, fake toasts, in-memory financial postings, unbounded fetch, unauthorized actions, user-trusted tenant/actor/roles, or public unauthenticated RPC.
- [ ] Local Workerd+D1 integration tests: SQL-time actor/shop permission, idempotent create/update, duplicate and race safety, reversed/disabled roles, import legacy mapping, replay/reversal, rollback, full gross statement reconciliation.
- [ ] Authenticated Owner browser E2E covers Party creation → another role → Purchases/POS due → receipts/payments → party ledger → reload/relogin, and two-Shop isolation with different and same-looking identities.
- [ ] Release to hosted Shop D1 only after CI, M03/M04/M08/M10 acceptance and owner-reviewed flag/schema/rollback verification; no forced production activation from documentation.

## Execution order and file ownership

1. **M01/M09 read-only UI lane:** preserve reference screens and write a UI parity adapter/prototype in separate Party-owned paths; do not touch shared Owner Worker, financial migrations, Party ledger writers or live flags.
2. **M02-P + M08 interface lane:** freeze source-ID mapping, multi-role/account kinds, gross balance sign and opening/loan contract; source-only fixtures, never an unapproved account-wide net.
3. **M03 integration lane (exclusive):** extend existing Party identity and Supplier/Customer role attachment under the current authorized Shop D1; add internal endpoints and SQL-time permissions in narrow RED→GREEN PRs. Keep existing original ERP fully working.
4. **M01/M09 integration lane:** swap Party preview controller for reviewed D1 services; connect only actually supported actions, retaining source component behavior. No misleading success.
5. **M08/M10 QA:** independent gross accounting/readback, reversals, local Workerd+D1, owner browser, phone/tablet screens, two-Shop isolation.
6. **M11 hosted gate:** deploy only after independent financial and auth release acceptance. M08-S optional manual cross-role settlement is a separate later milestone.

All implementation must follow `AGENTS.md`, GitHub branch→PR→CI, Superpowers plan→test-first RED→minimal GREEN→refactor→retest→QA/review, KISS, narrow file ownership and human-approved merges. This design PR is an **approval record and implementation handoff only**, not executable feature delivery.
