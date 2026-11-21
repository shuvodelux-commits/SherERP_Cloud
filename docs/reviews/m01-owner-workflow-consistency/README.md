# Owner UI and workflow review

The Owner compiler applies the approved HisabIQ palette, typography and surface tokens to the authenticated shell. Purchase and Product dialogs also use the canonical control sizing and spacing. The public bundle and frozen source bytes preserve their existing compilation paths.

| Workflow | Evidence | Visual review |
| --- | --- | --- |
| Add Product | [Before and after](product.webp) | New Category and Unit actions use the existing form controls. The product modal uses the shared palette and form type scale. |
| Enter a product category | [After](category.webp) | The first rendition used a full-height mobile dialog. The reviewed dialog now fits the name field, action and confirmation copy in a compact panel. |
| Add Party | [Before and after](party.webp) | The relationship selector receives initial focus. Supplier opening-balance guidance appears after selecting Supplier. Other relationships display their release status. |
| New Purchase | [Before and after](purchase.webp) | Removing the repeated Day Open card restores the purchase form to the start of the page. The topbar remains the Cash Session entry point. |

Chromium captures use five widths (320, 390, 768, 1024 and 1440px) and the actual compiled UI. Baseline source is `7ecd6dbeb7f8b6a20ec16cc89b1aecfc14addd40`; screenshot API responses contain synthetic data. Separate browser fixtures exercise persistence and authorization on disposable Workerd D1. The exact `/ui-refine-skill` is unavailable in this environment, so the visual review uses the manual screenshot fallback. Refero returned `NO_SUBSCRIPTION`. The repo's pinned HisabIQ design system and existing Product, Purchase and Party surfaces supplied the reference.

New Category and Unit values persist with a successfully saved product and appear in later Add Product choices. Standalone master registration and deletion require their own reviewed integrations. The validated Party creation path supports Supplier with zero historical opening balance. Other relationship writers remain subject to their native account and authorization contracts. Purchase posting continues to require an open session under the existing SQL policy.
