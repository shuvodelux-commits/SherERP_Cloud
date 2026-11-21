# M01 HisabIQ Sales UI parity — scoped design

**Reference:** `shuvodelux-commits/hisabiq_ui@e42a00a`, `src/pages/Sales.tsx`, `src/components/sales/SalesWideToolbar.tsx`, `SalesMobileLayout.tsx`.
**Target:** SherERP Cloud `main` (2026-11-21), preserved `legacy/source/sales.html`, compiled Owner ERP with existing D1 invoice list and detail reads.

## Goal
Provide the same compact teal/ink/Geist Sales visual language, information hierarchy, toolbar, tab affordances, invoice table, dialogs and responsive layout as the reference, while retaining original handlers, restrictions and financial source.

## Chosen approach
Enhance the **compiled Sales surface only**, like the existing HisabIQ dashboard/shell integration. Preserve the byte-for-byte legacy source and unchanged `smLoad`, `smRender`, `smOpenView_`, row action routing and RPC contracts. A JS/CSS enhancement adds header, loaded-invoice summary, local column visibility, sorting, page controls, CSV export, keyboard affordances and adaptive desktop/mobile table presentation. All changes are read-only and client-side on **already returned** `smState.sales`. No accounting transactions or new API endpoints.

## Explicit limits / safety
- Do not import demo invoices or React preview stores. Loading/error state and availability remain driven by the real owner loader and Shop D1.
- Reference Items and Payment columns cannot be claimed from a list lacking those fields; they remain available in the existing invoice detail only where actual data is present.
- Existing separate Sales Return, Return History, Drafts and Customer screens keep their permissions and behaviors; do not replace them with inert tabs or fake data.
- Owner/D1 invoice actions enabled only by the existing backend flags; do not expose disabled payment, edit or delete capabilities.
- No new D1 schema, public RPC, source restoration, write path, transaction policy or deployment action.

## Acceptance
Compiled Owner ERP retains the original IDs and original RPC calls; the enhanced Sales header, summary, table controls and mobile views mount exactly once; no duplicate financial postings; sorting, filtering, visibility, pagination and CSV export only affect the client view; empty/unavailable states remain truthful; keyboard, touch and responsive states work at 320, 390, 768, 1024 and 1440px. Produce Playwright source/target screenshots and an explicit visual-diff log, retain CI evidence, and require independently approved production release.
