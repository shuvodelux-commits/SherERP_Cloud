# PORT-00 P2 local two-shop proof implementation plan

Issue [#699](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/699).
Base `8fc6e7fd1d4fa78d84e3c45f4d25b85c613f57cc` after #717.
M03 owns the internal binding resolver and Workerd proof. The
[provisioning design](../../installation/PORT_P2_PROVISIONING_AND_RECOVERY_DESIGN.md)
defines the separate hosted approval boundary.

- [ ] RED. Use one test-only Worker host, two physical Shop D1 databases and
  real Control D1 Owner sessions. Seed the same sentinel ID with two different
  values. Assert both Owners get their value and a swapped binding fails closed
  before adding the resolver.
- [ ] GREEN. Read current Owner placement from Control D1 with the existing
  opaque session hash and enabled Owner policy. Select only the configured
  static binding, verify its identity and pinned schema receipts, then
  recheck authority before returning the binding. Preserve pilot callers.
- [ ] RED then GREEN. On disposable D1 only, apply a pinned migration prefix
  and inject an error at the next migration's receipt. Verify rollback of
  that batch, unchanged prior rows, exact resume, repeat no-op and refusal
  on changed bytes or a mismatched database.
- [ ] Refactor and test. Exercise a prior Worker roster against the same
  physical databases, a revocation, a forged shop selector and real D1
  readback after recovery. Run the new suite from existing M03 local-only CI.
  Run affected tests and full PR CI. Leave merge to independent review.

Shared paths in scope are the existing Owner context query and the M03
Workerd CI step. New logic is internal; the probe and migration executor live
under tests. No staging profile, public route, source data or financial SQL
changes are part of this PR.
