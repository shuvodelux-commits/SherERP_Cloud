# M09 — HisabIQ Settings & Invoice Studio UI handoff

Issue #870. Pinned reference `shuvodelux-commits/hisabiq_ui@e42a00a9f48ffc1f5c4ec10083e36d9eb4686484`: `src/settings/magic/SettingsNav.tsx`, `settingsSections.ts`, `invoice/InvoiceStudio.tsx`, `DocumentDesignSettings.tsx` and `docs/settings/README.md`. SherERP baseline: `9670c5e2` (source manifest: 84 verified files). Owner approval: redesign Settings like HisabIQ and bring Invoice Studio into Settings, while advancing business-scoped Users/Roles under #867.

## UI implemented on this branch

- Full reference-style searchable directory, bilingual grouped navigation, active/current page, responsive horizontal tabs (<1024px), deep-link to original General, Invoice, Users and Roles pages and Settings-home action.
- Invoice preview selector: Standard / Classic / Compact with three unsupported design choices disabled. Paper A4, 80 mm, 58 mm, Business Pad preview sizes; English/English+Bangla/Bangla; live content visibility toggles for business, customer, SKU, discount, payments, due, amount in words, signature and warranty.
- Pinned Ink/Teal/Geist/Hind Siliguri, 36px controls, 6px input radii, 12px cards, proportional numbers, reduced motion and 320/390/768/1024/1440 Playwright viewport matrix.
- Original `legacy/source/settings.html`, `invoiceDesign.html`, `users.html`, `roles.html`, original printer and D1 financial code **unchanged**. Source controls remain in clearly labeled disabled/read-only surfaces for later approved integration.
- M04 user/role UI is discoverable but cannot create/enable staff until #867 is authorized by the correct Shop and live session, no synthesized Owner/Staff credentials or cross-Shop access.

## Strict scope and blocked backend behavior

**This is a UI candidate, not a connected Shop D1 Settings or Invoice Studio.** All preview choices are ephemeral and change no invoice, settings, printing or business records. The current Owner Worker does not expose approved staff-CRUD or authenticated settings-save RPCs; no false Save actions are shown. The original pages are preserved for reviewed future plumbing. Unsupported and future settings are labelled not connected rather than being actionable. No production cloud migration/deployment/remote write is authorized.

## Evidence

- First RED: missing `patch-owner-hisabiq-settings.mjs` module.
- GREEN: `node --test tests/m09-hisabiq-settings-ui.test.mjs` 2/2; `node --test qa/m09-hisabiq-settings-browser.spec.mjs` includes invoice gallery/options and viewport matrix (exact final test evidence in PR).
- `npm run verify:source`: 84/84; `npm run docs:check`: pass; `npm run build:owner-frontend`: pass; `git diff --check`: pass.
- [Desktop invoice UI](images/1440-invoice.png) · [Mobile invoice UI](images/320-invoice.png) · [Mobile settings directory](images/390-settings.png). These are synthetic fixture screenshots, not hosted authenticated acceptance. A transient existing Owner 'data not connected' toast may be visible in synthetic captures; this is not an invoice save response.

## Before merge or feature enablement

PRs #866/#869 both edit `scripts/build-owner-frontend.mjs`; coordinate rebase or shared build integration, not blind merging. M03 owns Shop D1 migrations/routes (and #690); M04 owns staff identity and authorization (#867); M09 owns future invoice settings persistence after server-side contract and print parity. Required CI and independent review on exact PR head. Full current invoice logo, branding, terms, numbering and print integration remain separate follow-up work; no claim of print renderer parity, persistent settings or deployment readiness.
