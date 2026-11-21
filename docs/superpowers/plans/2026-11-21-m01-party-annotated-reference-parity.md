# M01 Party Annotated HisabIQ Reference Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans, TDD RED→GREEN, screenshot checks and exact-head PR.
>
> **Source lock:** `shuvodelux-commits/hisabiq_ui@e42a00a9f48ffc1f5c4ec10083e36d9eb4686484`, `src/pages/Parties.tsx`, `src/components/parties/Party{Directory,Detail,PaymentDialog,EditorDialog,LedgerRowActions,SourceQuickPreview}.tsx`.
> **Visual lock:** five user-uploaded screenshots (1440px Party ledger, Payment dialog, Allocation dropdown, Invoice source preview, Add Party modal) with red-number annotations; no invented visual theme.
> **Target:** `shuvodelux-commits/SherERP_Cloud@090c5a4b00f240628c96cbbf319361d26bd24cfd` original authenticated Owner HTML/JS plus scoped HisabIQ overlay; not React rewrite.

## Goal

Match source Party directory+detail and annotated interactions: row actions, real ledger source amounts, contextual More, receive/payment dialog footprint, exact allocation dropdown affordance, read-only invoice/source preview, and full seven-role Party editor with bilingual input, explicit opening direction and date — while never masquerading unsupported preview financial operations as real D1 writes.

## Important production bounds

1. Current D1 Owner Worker exposes actual Supplier get/create/ledger and Supplier historical opening as separate route; it does NOT expose generic seven-role Party create, Customer due receipt, split payment, complete finance journal, verified line-item read from every role, or an auditable correction engine.
2. The `hisabiq_ui` source's payment, Add Party multi-role, source ledger preview and notes use `dispatchPartyPreview`, not live D1; these must NOT become fake success toasts or localStorage postings.
3. This M01 PR changes **only Party UI CSS/JS, Party browser/contract tests, design evidence and this plan**. Do not modify M03 Worker, auth, SQL, shared Owner shell, finance posting or unrelated module.
4. Existing Supplier create must remain available with zero opening, immutable operation ID/retry, exact Shop access and real D1 reload. Generic roles or nonzero opening must stay safely blocked with explanatory copy.
5. Make Party the primary combined discovery surface; **do not delete or disable legacy Customer/Supplier/Finance ledgers yet**, as those are still the only source-backed workflows for certain accounting paths. Maintain stable original routes and records until D1 cutover acceptance.
6. Responsive reference breakpoints 320, 390, 768, 1024, 1440; 36px inputs, compact desktop two-column Party split, phone drawer, Bengali helpers, Geist/Hind Siliguri, no monospace numeric fonts, dark and reduced motion.

## Screenshot annotation checklist

- Image 1: [1] contextual More; [2] Receive payment, [3] ledger row action, [4] note row, [5] debit, [6] credit. Correct credits and ledger period/gross balances must come only from authenticated source entries.
- Image 2: [1] payment source `+ Add`, [2] invoice/bill allocation combobox, [3] full outstanding shortcut, [4] Bengali amount-in-words. Unsupported financial POST disabled with explicit Shop capability notice.
- Image 3: allocation dropdown options visually styled and keyboard-reachable; only verified invoice IDs can be offered, never made-up demo invoices.
- Image 4: read-only source document preview with exact reference, date, debit, credit and running value; item quantities/details only when authenticated source endpoint actually supplies them.
- Image 5: [1] Party name [2] phone [3] address [4] Bangla name [5] relationship checkboxes [6] per-role opening sections [7] opening amount direction; document permitted Supplier zero-opening only until M03/M08 cash-safe writer exists.

## TDD tasks

- [x] New Party contract test RED before modifying production: 4/4 original assertions failed and the separate Bangla-words assertion failed; 20/20 combined contracts GREEN after source-only Supplier preservation.
- [x] Add seven-role editor fields and explicit opening fields, Supplier-only D1 save with no nonzero posting; update existing two Party browser suites for checkbox instead of single-role select.
- [x] Render source-faithful profile actions, content tabs, compact ledger toolbar/filters, row menu and safe source preview; all other actions visibly unavailable without backend.
- [x] Test verified source filtering, no manufactured invoices, keyboard focus, Escape, mobile 320/390, tablet 768 and desktop 1024/1440, dark/reduced motion and real two-Shop Supplier D1 path.
- [x] Inspect Playwright screenshots at 390/1440 for all five annotated views; fix 7px desktop table overflow and 390px payment grid; run 84-file frozen-source verifier and 7/7 original Owner regressions. Original five reference screenshots supplied in this chat, not reverse-engineered from synthetic fixtures.
- [ ] Stage isolated GitHub PR; do not retire historical ledgers unless backend parity tests establish an equivalent verified path, original source IDs and transaction reversal.

## Skill verification

- `hisabiq_ui/.claude/skills/super-board` is a Git symlink to `../../vendor/super-board/skills/super-board`, but that vendor target is not present in the public repo tree; no runnable Super Board launcher has been verified. **Do not claim the named skill ran.** Use available Superpowers TDD plan, pinned source, UI consistency / screenshot review and Playwright as the documented fallback.
