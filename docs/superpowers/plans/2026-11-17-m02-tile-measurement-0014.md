# M02 — immutable tile measurement revision persistence

**Goal:** Add inert migration 0014, with exact measurement text and existing
product/unit revision FKs, proven on SQLite and actual local Workerd/D1.
**Base:** main c73c333c51ea0e90e8fac73c63efb4e906c43d54, migrations 0001–0013.
**Spec:** docs/superpowers/specs/2026-11-17-m02-tile-measurement-0014.md.
**Method:** Superpowers RED → GREEN, GitHub-first, KISS; execute sequentially.

## Module overview (12 sentences)

1. This increment stores immutable tile measurements against the existing product-unit revision.
2. It adds one table rather than a separate tile inventory or transaction engine.
3. The original Product ID and Pcs inventory dimension stay unchanged.
4. Dimensions and optional manufacturer coverage use bounded exact decimal text.
5. Nominal coverage remains derived instead of a second persisted arithmetic authority.
6. Manufacturer coverage needs an explicit positive value and evidence reference.
7. The selected pack must belong to the exact product and revision and have an exactly equal integral factor.
8. Revision rows preserve coverage policy, pricing units and optional Sqft price overrides.
9. Existing Box/Pcs pricing continues to use the existing unit profile.
10. Both SQL immutability and native relationship constraints are tested on actual local D1.
11. Local migration-count gates change explicitly while remote migration authorization remains unchanged.
12. This is inactive schema only, with no importer, financial posting, public RPC, UI or production deployment.

## Ownership, dependencies and decisions

- M02 owns this isolated candidate measurement DDL; no shared M03 reader or posting kernel changes.
- Canonical source Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2 remains unchanged.
- Supplementary units sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c remain a distinct reviewed source.
- PR #438 defines the pure calculation/catalog contract but is not needed to apply this migration or execute its independent SQL tests.
- Schema: existing products/unit revisions → measurement revision → later reviewed M03 adapter → M05/M06/M07/M09.
- Scope is one isolated business per D1. Do not claim shared-tenant isolation or private-data reconciliation.
- Refinement of earlier proposal: persist original exact configuration only, not duplicate nominal rational results that SQL cannot safely recompute for arbitrary decimal sizes.
- Sqft-only price overrides are commercial metadata; do not invent a fractional physical Sqft conversion row or a second price engine.
- No financial/Party DDL, source-data import, remote apply, login/RPC activation or cross-role settlement.

## TDD tasks

- [ ] Write Node SQLite and actual Workerd/D1 tests before 0014 exists.
- [ ] Observe missing migration as RED; record local command and GitHub RED commit.
- [ ] Implement minimum STRICT table, exact decimal checks, same-product/revision/pack guard and immutable UPDATE/DELETE triggers.
- [ ] Test valid dimensions/policies/price metadata, invalid decimals, missing/cross-product parents, pack mismatch, unsafe/fractional Pcs, duplicate revision and immutable history.
- [ ] Test concurrent duplicate inserts, late-batch rollback and clean database initialization on real local D1.
- [ ] Update explicit local 13→14 migration gates and table/trigger evidence; never loosen the existing remote two-migration approval guard.
- [ ] Run full Node 22/UTC suite, real D1 schema/import regressions, source/build and applicable hosted CI.
- [ ] Open scoped PR against main; leave merge/remote migration gated on review.

## Review focus

- Exact text must not be checked through binary REAL coercion.
- Optional manufacturer coverage/evidence must form a complete pair.
- A fractional or near-integer pack factor must not compare equal by float rounding.
- Rows must not be retargeted to a new product/revision or erased.
- New DDL does not confer manufacturer verification, revision sealing, stock or financial posting authority.
