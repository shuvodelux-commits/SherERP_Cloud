# Clean shop first product implementation plan

Issue #690, M03. Related workstreams #22 and #23.

This first slice rehearses empty shop setup on two separate local D1 databases. It applies the existing shop identity and catalog migrations without importing source rows. It uses the existing Owner session service with synthetic verified identities. A fixture Worker lists products for the selected test shop. It can create a standard zero-stock product using a test operation ID. The same request can be retried without making another row. A changed request with the same operation ID must fail. The existing product rule against duplicate active names also applies in the fixture. Another shop, a missing session, and a revoked session must all be denied. Product prices stay decimal text and this proof posts no lot, sale, or money movement. The fixture is excluded from all release configurations. A future application writer still needs a reviewed source Product ID allocation and write authority that accounts for revocation during a write.

1. Add the Workerd integration test with an empty catalog, first save, replay, cross-shop checks, and denial after revocation. Confirm RED before writing the fixture handler.
2. Implement the minimum fixture handler in `tests/fixtures/m03-clean-shop-product-worker.mjs`. Reuse the existing migrations and Owner validation. Keep application and deployment files outside the change.
3. Run the focused Workerd test. Register the test with the existing local staging integration suite and open a scoped PR. Use this proof as the starting point for the next clean shop slice.
