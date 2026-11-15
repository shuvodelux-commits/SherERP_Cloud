# M09 Settings + Invoice Design bootstrap — Superpowers RED/GREEN

**Date:** 2026-11-15. **Branch:** `m09/settings-invoice-bootstrap-read-20261115`. **Pinned source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

1. Read source `Settings.gs` getSettingsBootstrap/getInvoiceDesignBootstrap; `Database.gs` getSettingsMap_ and `Invoice.gs` resolveInvoiceLogoDataUri_; their original HTML; M09 and M04 safety gates. Avoid shared M03/M04 and active M09 Reports-bootstrap D1 PR #224.
2. Commit **only** spec/plan and new `tests/m09-settings-invoice-bootstrap-read.test.mjs`. Run frozen original function bodies in Node VM, under mocked `settings:view` auth, Settings, Bank Accounts and pre-resolved Invoice Logo. Assert exact entire native success response, order, values, type retention, active bank filtering and no balance leak; add trust and mutation negative tests.
3. Open draft PR. Verify **RED in actual exact-head GitHub Actions** for expected missing projection module, not fixture/config failures; fix test harness first if necessary.
4. Write minimal `src/modules/settings-invoice-bootstrap-read.js`, separate pure read functions and tight trust validation. Do not introduce arbitrary user input, async D1 reads, bank/finance writes, auth/RPC, Storage, UI replacement, extra dependencies or caches.
5. Verify full exact-head source/Worker Node tests (original 84 pinned files and 36 UI includes), local D1/Workerd checks, M04/Party tests, Chromium desktop/mobile/A4 and Cloudflare secret-free preview CI. Repair source drift via test-first rule as applicable; never claim green until actual logs.
6. Review file inventory and rollback; update PR body with SHA/jobs/CI, source-contract boundaries and the future authenticated D1/asset reader gates. **Do not merge without owner review and completed CI**.

**Rollback:** revert four new files; no D1/production data impact.
