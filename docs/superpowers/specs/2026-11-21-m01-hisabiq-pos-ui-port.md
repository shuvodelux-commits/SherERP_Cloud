# M01 HisabIQ POS V2 visual port — UI-only specification

**Authority:** Owner request, pinned `hisabiq_ui@e42a00a9f48ffc1f5c4ec10083e36d9eb4686484` POS V2 and SherERP HisabIQ design contract.

**Intent:** Replace the apparent Classic POS V2 styling in the authenticated Owner shell with the HisabIQ POS composition: teal/Ink system, New sale toolbar, compact cart at left, quick items below it, checkout/customer at right; on phone all three sections stack and remain reachable without switching hidden tabs. Use original POS controllers, DOM IDs, data and posting guards.

**Scope:** Owner compiled frontend only. New opt-in CSS and presentation-only DOM controller. No schema, D1, RPC, auth, posted sale intent, pricing, stock/FIFO, cart data model, or original legacy source modifications.

**Visual contract:** Geist/Hind Siliguri; 36px regular fields; 48px terminal CTA; 6px control corners, 12px panels; 13px cart values; proportional digits; light/dark; visible focus; compact 320/390/768/1024/1440; desktop cart/quick-items beside checkout; phone cart, quick items, then checkout, every line subtotal/removal visible.

**Behavior:** Product quick items reuse actual `#posProductGrid .product-tile` click handlers and existing `posAddToCart_`, no fake data. New F2 Search focuses existing product input. Existing Draft and Add Product buttons retain handlers, permissions and hidden status. Existing checkout and split-payment feature flags remain authoritative; new UI never creates a payment writer.

**Explicitly not delivered by this UI change:** Exact React component byte-for-byte reuse (different stack); compound multi-unit quantity/price selector when current Owner/D1 payload lacks its atomic source contract; installment sale, real templates or split payments without activated backend. Do not render working-looking controls for these until server ready. Mark parity partial.

**Risk mitigation:** Patch fails closed if compilation boundaries change; does not touch Classic POS or public app; hold legacy UI and rollback by reverting one PR. Test contract plus actual compiled Owner Chromium layout/interaction screenshot evidence, with D1 untouched.
