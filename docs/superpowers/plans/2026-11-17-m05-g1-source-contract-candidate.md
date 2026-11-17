# Superpowers — M05 G1 source contract candidate (2026-11-17)

- **Issue:** #485 (follows owner-closed #314); **coordination:** #456, M03 #22.
- **Main base:** `bcd2d3adbd03f35612c50c1a144a472b1683b412`.
- **Workstream/file owner:** M05, newly added `docs/m05/G1_SOURCE_CONTRACT_CANDIDATE.md`, `docs/superpowers/plans/2026-11-17-m05-g1-source-contract-candidate.md`, `tests/m05-g1-source-contract-candidate.test.mjs`.
- **Source:** pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` and approved `sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c`.
- **Current dependency:** merged #480 historical Tiles lot audit; M03 reviewed G1 handoff #474 is `REVIEW-ONLY`; M02/M04 identity, party and authorization implementation gates remain blocked.
- **Affected SQL/HTTP/RPC/Worker:** none; no source, DB or legacy records edited.

## Twelve-sentence overview and explicit acceptance

1. M05 has source-parity, privately consumed purchase, stock, FIFO and Tiles helpers but no approved real-D1 posting interface.
2. The next safe deliverable is a review-only G1 candidate that inventories current M05 function names, input expectations and evidence status.
3. The handoff must retain the source method's one base-quantity stock movement for each mixed-unit purchase line.
4. The original 1 Bag + 2 Box + 5 Pcs example must still equal 145 Pcs and conserve its unit-specific prices independently of browser claims.
5. The original purchase supplier, optional Cash/Bank tender and due amount must not be auto-netted into other Unified Party role accounts.
6. Original source single-unit purchases must remain valid without fabricated unit snapshots.
7. An independent arithmetic conservation report must verify the trusted unit-price and quantity snapshots before a candidate is reviewed.
8. FIFO preview must refuse a positive Deleted lot even when source FIFO and price paths differ.
9. Tiles stock must keep signed OVERSOLD amounts, immutable measurement revisions and exact nominal versus manufacturer square-foot coverage distinct.
10. M03 alone can later validate tenant/actor/session, source IDs, lot CAS, supplier obligations, operation receipts, replay and rollback atomically inside real D1.
11. This PR will add cross-module regression tests before its candidate contract document and will not modify any M03-protected path or activate public writes.
12. A genuine RED failure, subsequent GREEN acceptance, exact-head full CI and human review are required before merging the documentation and tests.

## Execution and rollback

- **RED:** commit the plan and cross-module test while `docs/m05/G1_SOURCE_CONTRACT_CANDIDATE.md` is intentionally absent, open draft PR against main and preserve a failing acceptance log; test directly exercises existing private M05 invariants.
- **GREEN:** write the M05 candidate document only, with exact source-derived contract/identity/Party/Cash Session/Tiles/FIFO/receipt fields; no helper implementation or shared file change.
- **Runtime evidence:** Node original-source regression tests and the repository's full 44+ GitHub Workerd/D1/browser/security workflows are still required, even though this slice adds no data access.
- **Important non-goals:** no M03 `G1-writer-v1` freeze, no API, no public RPC, no D1 migrations, no Cash/Bank/Party posting, no live sale/purchase/edit or private data import.
- **Risk/rollback:** accidental promotion of preparatory evidence into posting authorization is prohibited; rollback removes the three new M05-owned files without any data effect.
