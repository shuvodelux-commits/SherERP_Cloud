# Superpowers TDD — M06 persisted receipt replay reconciliation

1. Review current target `AGENTS.md`, source SHA, M06 synthetic D1 contract, invoice/child schema and existing Workerd/D1 tests.
2. Create a fresh GitHub-only branch and file-scoped plan. No remote D1 or frontend changes.
3. **RED:** append local Workerd/D1 tests that first post an authorized sale, then simulate one extra persisted Cash Book/tender/Bank child row using direct isolated fixture SQL, and assert same-operation replay fails `NEEDS_REVIEW`. Check real Actions M03 integration fails for a behavioral reason.
4. **GREEN:** in the existing synthetic contract, make replay verify exact tenant/invoice child rows against canonical planned tender, owned-item and Customer-due expectations; include draft audit when applicable. Use read-only queries; reject any unavailable, malformed or differing evidence.
5. **REGRESS:** clean duplicate submit remains `REPLAY`; new posting, race, draft consumption, complete rollback and Party gross account separation remain unchanged.
6. **VERIFY:** full Foundation, M03 local Workerd/D1, M01 Chromium, M04 auth and Cloudflare PR safety on exact head; record failed/fixed counts and leave a scoped draft PR for owner review.

**Owner boundaries:** do not modify `src/db`, `src/rpc`, migrations, original GAS/HTML, live database or shared posting kernel. No deployable feature flag, no external financial settlement, no speculative rewrites. Real production proof remains separately blocked.
