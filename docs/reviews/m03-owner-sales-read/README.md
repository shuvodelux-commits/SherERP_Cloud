# Owner Sales Invoice visual review

The Playwright fixture builds the real original Owner app, runs it in Chromium, and sends same-origin requests to the private Owner Worker against disposable Shop D1. Its generated invoices and session IDs are synthetic. All views use a 900px height with widths of 320, 390, 768, 1024 and 1440px. The baseline build uses `c002c8390adf1796880373672ca45d3723ebf159` and the after build uses the code in this PR. The pinned Mohim_ERP source remains byte-identical.

| State | Screenshots | Observed |
| --- | --- | --- |
| Before | [Five widths](before.webp) | Global warning and unsupported-action toast appeared above an unexplained blank Sales table. |
| Empty | [Five widths](empty.webp) | A successful empty Shop reports no saved invoices inside the Sales card. |
| Loaded | [Five widths](loaded.webp) | Original table and mobile cards show the persisted invoice and partial return. At 320px the original mobile grid split status badges character by character. The status cell now spans the card and preserves whole badges. Dates and long numbers can wrap at the narrowest width. |
| Detail | [Five widths](detail.webp) | Original responsive invoice modal shows totals, return amount and Owner profit. Print and JPG controls remain, while payment and deletion are unavailable. The fixture explicitly enables Cash Returns. |
| Release disabled | [Five widths](unavailable.webp) | Screen gives the release reason with Refresh still available. |
| Binding error | [Five widths](error.webp) | A scoped error directs the Owner to their administrator and clears the stale list. |

The browser regression also verifies same-page navigation back from POS, wrong Shop handling, recovery after revisiting Sales, and the same invoice after reload and a newly issued Owner session. It checks that disabled Returns are hidden in the detail modal and that a failed topbar refresh produces no success toast. The exact `/ui-refine-skill` is unavailable in this environment. The screenshot capture and manual visual review used the repository's fallback. Hosted Google sign-in, full accessibility certification and production visual acceptance are pending.
