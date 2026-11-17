# M01 original application shell — taste and direction

**Target:** original `/` route (sign-in, synthetic Dashboard navigation and mobile “More” dialog).

The direction follows previously approved SherERP requirements rather than introducing a new design decision.

- **Goal:** Preserve source-faithful ERP UI while verifying keyboard access and responsive layout.
- **Direction:** Same look, cleaner semantics. No redesign, new theme, framework change or live financial data.
- **Keep:** Original blue/gray palette, bilingual helper copy, compact touch-friendly controls, frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` source, source checksum and fail-closed Worker.
- **Users:** Bangladeshi hardware-store staff on keyboard and phones as small as 320–390px.
- **Screen states:** Public login and a synthetic Clerk with harmless read-only Dashboard/Reports permissions. No real login, stock, ledger, sales, customer or tenant data.
- **Visual proof:** Super Board Playwright 1440px and 390px light/dark browser-emulation screenshots; dark mode is not claimed as a supported product theme.
- **What may improve:** Document language and title, visible-label association, modal focus entry/trap/restoration; these should change **behavior, not appearance**.
- **Exit:** Two consecutive post-fix checks without a reproducible P0/P1 in the scoped shell, Playwright evidence on GitHub, full exact-head CI and human-reviewed draft PR.

The prior UI source is intentionally frozen; fix work outside the original M01-owned QA scope requires a separate M03 integration review.
