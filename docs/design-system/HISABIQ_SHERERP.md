# SherERP × HisabIQ UI — canonical design system

**Status:** owner-approved design baseline, 2026-11-21. **Scope:** all NEW or deliberately migrated authenticated Owner ERP UI, starting with Party; do not redesign or override already-working legacy HTML modules, hosted Admin/security UIs, POS, or financial behavior as a side effect. **This specification does not claim a runtime UI port or deployed CSS.**

**Pinned source:** [`shuvodelux-commits/hisabiq_ui@e42a00a9f48ffc1f5c4ec10083e36d9eb4686484`](https://github.com/shuvodelux-commits/hisabiq_ui/tree/e42a00a9f48ffc1f5c4ec10083e36d9eb4686484). It is the source of truth for visual parity, while [SherERP ADR-007](../architecture/ADR-007-unified-party-relationships.md), [ADR-008](../architecture/ADR-008-hisabiq-party-ui-parity.md), `AGENTS.md`, security/accounting contracts and current explicit owner decisions control behavior.

**Artifacts in this repository:** [`hisabiq-tokens.json`](./hisabiq-tokens.json) (machine-readable reference), [`src/ui/hisabiq/hisabiq-design-system.css`](../../src/ui/hisabiq/hisabiq-design-system.css) (opt-in, scoped CSS base), [`tests/hisabiq-design-system.test.mjs`](../../tests/hisabiq-design-system.test.mjs) (source-value and scope invariants). **No runtime imports have been added.** Build only necessary UI with shared components, not another design library.

**Authority:** owner decision → SherERP approved contracts/AGENTS/ADR-007/ADR-008 → [HisabIQ Design Guide v2.2](https://github.com/shuvodelux-commits/hisabiq_ui/blob/e42a00a9f48ffc1f5c4ec10083e36d9eb4686484/docs/ui/HISABIQ-DESIGN-GUIDE.md) → actual components at pinned SHA → older static illustrations. Where an older guide description conflicts with live source implementation, prefer the newer implementation for exact animation behavior and flag the drift.

## 1. Identity and theme

| Semantic token | Light | Dark | Usage |
| --- | --- | --- | --- |
| Background | `#F5F7FA` | `#0B1A2C` | ERP workspace |
| Card/popover | `#FFFFFF` | `#14263B` | Table panels, menus, dialogs |
| Foreground/Ink | `#0B1A2C` | `#EDF3FA` | Body and headings |
| Muted foreground | `#5A6B80` | `#B1BED0` | Secondary text |
| Helper | `#607086` | `#9FAFC3` | Short explanatory copy |
| Primary | `#0D7C74` | `#3DB8AC` | Actions, active underline |
| Primary hover | `#0A625C` | `#55CBBD` | Filled-action hover |
| Primary foreground | `#FFFFFF` | `#0B1A2C` | Button text (dark ≠ white) |
| Accent | `#EAF6F4` | `#133B3A` | Gentle selected surface |
| Border | `#E3E8EE` | `#2E425B` | Card separators |
| Input boundary | `#7B8999` | `#6A819C` | Controls |
| Focus ring | `#0D7C74` | `#3DB8AC` | Keyboard navigation |
| Inverse | `#0B1A2C` | `#22364F` | Selected category/segment |

Status pairs: Success `#116F35/#E8F5EC` (dark `#7DDFAB/#13392C`); Warning `#974407/#FDF3E3` (dark `#F7C47B/#3B2B17`); Danger `#B92E25/#FCEBEA` (dark `#FFAAA1/#402328`); Info `#1E56D3/#EAF0FD` (dark `#A4CBFF/#1D2F4B`). Color cannot be the only signal for Paid/Receivable/Payable or invalid state. Use semantic tokens; do not hardcode literal colors inside each screen. Preserve Light/Dark/System appearance, including portal popovers and print (print is white background/dark text).

## 2. Typography

Use **Geist** (English/interface), **Hind Siliguri** (Bangla). Web-font loading must not block the app; define system-font fallback. No monospaced money or reference IDs, and no tabular-nums/`tnum` in newly-authored UI or tables. The original `src/index.css` body has historical global `tnum` drift; the authoritative table contract explicitly overrides that to proportional digits.

| Component text | Size / line-height | Weight |
| --- | --- | --- |
| Page title | 20/28px; compact Party header 18px, 20px at xl | 600 |
| Panel or section title | 14/20px | 600 |
| Dialog title | 18/26px | 600 |
| Body paragraph | 14/20px | 400 |
| Standard field label | 13/20px | 500 |
| Input value/textarea | **13/20px** across breakpoints | 400 |
| Table and mobile row value | **13/20px** | 400–500 |
| Table heading | **12/16px** | 500 |
| Table helper/badge | **11/16px** | 400–500 |
| Standard button | 14/20px, small variant 12.8px | 500 |
| Terminal transaction CTA | 15/20px | 600 |
| Dashboard metric | 22/28px | 600 |
| Major checkout summary | 28/34px | 600 |

Always display actual money in correct ৳ formatting and maintain exact paisa. Right-align quantity, amount, balance, price; never change stored numeric precision to fit a label. Phone/OTP/IDs are strings that retain leading zero. Bangla labels wrap naturally; no uppercase or forced tracking.

## 3. Size, shape and space

| Pattern | Binding value |
| --- | --- |
| **Universal button/input/select/combobox** | **36px height** at desktop, tablet and phone; icon button **36×36px** |
| **Explicit final sale/purchase/payment transaction CTA** | **48px height only when workflow action is marked `complete`** |
| Control corner | **6px**, `0.375rem` |
| Card/panel/modal corner | **12px**; badges **6px**; only natural pills rounded-full |
| Internal icon | 16px; sidebar/navigation 20px; empty-state icon 32px |
| Table body/header/helper | 13/12/11px; read-only cell spacing 12px horizontal and 8px vertical |
| Normal read-only row | Intrinsic ~36–40px; no fake 44px minimum for all rows |
| Form label gap | 6px; field error/helper 4px; controls gap 8px, tight group 6px |
| Panel padding | 16px; page gaps 16–24px; phone gutter 12px, sm 16px, lg 24px |
| Dialog viewport | `max-height: calc(100dvh - 2rem)`, scroll inside; `max-width: calc(100vw - 32px)` |
| Dialog content cap | Quick Add 448px; editor 512px; detailed 672px; source preview 896px |
| Popup safety | At least 8px viewport margin; close/open above when needed |
| Popup default width | AppSelect max 264px; SearchSelect max 380px |
| Compact desktop Party split | Directory 340px at lg, 380px at xl; detail minmax(0,1fr) |

Use spacing scale **4, 8, 12, 16, 20, 24, 32, 40, 48px**. Source has minor optical 2px and compact 6px exceptions; avoid arbitrary fixed heights or zero-accessibility tap targets. Layout is content-driven at 320/390/768/1024/1440px.

## 4. Shared component inventory and reuse policy

| Component / pattern | Source-of-truth | What SherERP must preserve |
| --- | --- | --- |
| `Button` | `src/components/Button.tsx` | 36px default; 48px only explicit completion; outline/ghost/disabled/loading, visible focus and 6px radius |
| `Input`, `NumericInput`, `MoneyUnitInput` | `src/components/Input.tsx`, `NumericInput.tsx`, `MoneyUnitInput.tsx` | 36px editor, 13px value, clear-X for search, numeric steppers remain inside their joined control |
| `AppSelect`, `SearchSelect`, `QuickAddSelect` | shared `src/components/*.tsx` | 36px trigger, keyboard/phone selection, active option, contextual Quick Add and auto-select, viewport-clamped popup |
| `Dialog`, `FloatingPanel` | `src/components/Dialog.tsx`, `src/components/layout/FloatingPanel.tsx` | One modal/popup layer, aria, Escape/Tab, body-lock, focus return, scroll containment |
| `Table`, `RoleBadge` | `src/components/Table.tsx`, `src/components/parties/RoleBadge.tsx` | proportional 13/12/11 type; no clipped amount or table-only zero-balance recomputation |
| `PageHeader`, `PartyBalanceCard` | `src/components/PageHeader.tsx`, `src/components/parties/PartyBalanceCard.tsx` | compact title/actions; semantically separate receivable/payable balances, not combined cross-role due |
| Tabs | `src/motion/MotionTabList.tsx` | 2px moving teal underline; selection changes without clearing Party state or delaying ledger |
| Party responsive | `PartyDetailAdaptive.tsx`, `PartyDetailResponsive.tsx`, `PartyDirectoryResponsive.tsx`, `PartyActionSheet.tsx` | desktop split ≥1024px, right picker on tablets and bottom picker on phones; one source data/controller |
| Party editor + financial dialogs | `PartyEditorDialog.tsx`, `PartyPaymentDialog.tsx`, `PartyFinanceDialog.tsx`, `PartyOpeningDialog.tsx` | exact surface forms, role-aware finance action names, separate openings and audit; **remove preview-only persistence** |

Pinned source code for every entry: `https://github.com/shuvodelux-commits/hisabiq_ui/blob/e42a00a9f48ffc1f5c4ec10083e36d9eb4686484/<path>`. Original HisabIQ is React/Tailwind/shadcn-style and uses Framer Motion. SherERP currently serves legacy HTML/JS: **do not import an entire React preview application or replace the Owner shell**. The owning UI engineer chooses a Party-only, independently loadable React island (if the bundle and auth model are reviewed) OR a fidelity-verified, accessible HTML/CSS port. In either case preserve the exact component contract and accessibility. Use one set of D1 Shop APIs and source-owned financial posting; no demo Party fixture in production.

## 5. Animation / motion tokens

**New React surface:** reuse Framer Motion only, not a second animation library. **Legacy HTML surface:** the scoped CSS file provides a small optional fallback with matching timings; never animate the same element twice. Component implementation wins over a stale general guide table.

| Interaction | Timing / form | Current exact authority |
| --- | --- | --- |
| Navigation hover | 110ms | `src/motion/tokens.ts`, fine pointer only |
| Navigation active | 190ms, cubic-bezier(.16,1,.3,1) | `MotionNavIndicator.tsx`; isolate layout IDs by nav instance |
| Sidebar expand/collapse | 220ms; first paint no transition | `src/motion/tokens.ts` |
| Tab selection | 200ms, cubic-bezier(.16,1,.3,1) | `MotionTabList.tsx`; precisely 2px underline, no duplicate shadow or indicator |
| Number stepper appearance | 120ms opacity-only | `src/motion/tokens.ts` |
| Button/focus colors | 150ms (background/border/shadow) | `src/index.css` |
| Dialog entry (current Party dialog implementation) | **180ms** fade 0→1, scale .96→1, rise 8px; cubic-bezier(.22,1,.36,1) | `src/components/Dialog.tsx`; veil 180ms. **Guide §22 lists older 220ms margin-offset behavior; actual current code is 180ms; do not double animate.** |
| Floating menu / select | 140ms fade, scale .97→1, rise 4px; 90ms exit | `FloatingPanel.tsx` and `SABAB-INTERACTION-MOTION.md` |
| Party bottom/right sheet | 280ms, cubic-bezier(.32,.72,0,1); veil 200ms | `PartyActionSheet.tsx`; phone y 100%→0; tablet x 100%→0 |
| Advanced filters reveal | 180ms in / 120ms out, rise 4px | `src/motion/sababMotion.ts` and `AnimatedAdvancedFilters.tsx` |
| Segmented switch thumb | spring stiffness 520, damping 38, mass .7 | `AnimatedSegmentedSwitch.tsx` |
| Top-level module entry | 280ms fade + 10px rise, once per module | `src/motion/sababMotion.ts` |

**Never animate:** balance count-ups, table row positions, financial calculations, stock, approval, posting, authentication, source ledger revisions, pending values or data-driven search results. Animation is only a presentational acknowledgement of actual state; it never gates business operations. Respect `prefers-reduced-motion: reduce`: zero positional travel and instant open/reveal. No spring bounce for financial confirmations. Tabs, dropdowns, drawers and all dialogs must retain keyboard order, click-outside, Escape and focus return.

## 6. Party / accounting presentation contract

- Use **one Directory** with seven combinable relationship labels and one Party profile; filter by selected relationship. URL state `?id=<partyId>&role=<role>` must survive navigation.
- Within a multi-role Party show each account separately. Customer AR and Supplier AP are **never summed or offset** into one signed scalar; Vendor payable and receivable are distinct, Owner equity and loans remain distinct, Payee identity does not imply money owed.
- Opening amount belongs to its selected role/account and does not represent Cash Book or Bank Book turnover; payments must use real source-owned D1 transaction paths and session policy.
- Recreate HisabIQ's right-pane tabs (Ledger / Invoices or Purchases / Payments / Notes / Attachments), contextual action icons and mobile picker. Source-linked row actions launch existing domain editors, not a second ledger posting engine.
- Show loading, blocked, permission denied, missing data, unsaved draft and actual saved/failed states. Never show a success toast for preview/local-only changes.

## 7. Opt-in CSS scope (no production override)

The CSS base lives at `src/ui/hisabiq/hisabiq-design-system.css` and only applies to containers marked `data-hisabiq-design-system`. When a vetted Party UI is mounted, import it once in its dedicated bundle and wrap its surface in that attribute. The stylesheet exposes prefixed `--hds-*` tokens, focus/size/typography helpers and optional native CSS animations.

**Do not** import the CSS globally into the currently deployed Owner ERP until visual regression, mobile/desktop, dark-mode and source-ledger tests have passed. CSS cannot enforce React keyboard semantics, dialog focus return or Party accounting; components and tests must do those jobs. Avoid leaking a global `:root`, `button`, `table` or `.dark` rule into old screens.

## 8. Minimum TDD / QA acceptance

1. `node --test tests/hisabiq-design-system.test.mjs`: catches drift of canonical token values, motion timings, number typography and component sizing; it is **not** a browser parity certificate.
2. Real browser proof at 320px, 390px, 768px, 1024px, 1440px, in both themes, English/Bangla, keyboard-only, touch and reduced-motion; review overlay clipping, 36/48px controls, 13/12/11 data text, 2px tabs, 180ms dialog, 280ms Party sheet.
3. Pixel-layout/reference comparison for Party Directory, responsive Party Profile, Editor, Ledger, Statements, Payments, role/finance sections; no reimagined UI.
4. Accessibility: WCAG AA contrast checked in rendered controls, visible keyboard outline, proper focus containment/return, no role chips distinguishable solely by color, dialog titles/labels/disabled reasons.
5. Finance-specific E2E: multi-role Party persists in real Shop-scoped D1; two Shops isolated; each ledger reconciles gross to its source and does not auto-net; operation failure/replay is not misreported as saved.
6. Keep every change on a narrow GitHub branch/PR, Superpowers RED → minimal GREEN → refactor → retest → QA → review. **Existing Shop/Owner deployment and D1 releases are not changed by this design-system adoption.**
