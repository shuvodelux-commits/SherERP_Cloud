# Tenant Control Center Run 1 implementation plan

Issues [#690](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/690)
and [#699](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/699).
Base `30d1020453046bbee0f195ad1691f8bee3e5eb00`. Dependencies
[#717](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/717)
and [#719](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/719)
are on main.

## Shared integration request

Reserve `src/m03-private-platform-auth-worker.js` and one additive Control D1
migration in `staging-migrations/platform-onboarding/` for the M03 owner.
The migration must preserve existing immutable reservation and binding
receipts. It records one operation per reservation, normalized Owner Gmail,
last completed stage, and a safe failure code tied to the failed stage.
Keep the capability disabled in deployment profiles. Reuse
`frontend/platform-auth/index.html` and `frontend/platform-auth/platform-auth.js`
for status, errors, and Resume. Local test files are isolated from shared DB
and runtime ownership.

## Test-first acceptance

1. Run real Workerd/D1 with the existing private Platform Worker and a
   seeded Control D1 Super Admin session. Demonstrate RED by submitting a
   valid name and Gmail to Create Business and checking its durable status
   under the same operation ID.
2. Reuse the M03 reservation authorization and Gmail normalization. Claim
   immutable intent and record progress in Control D1. An identical submit
   reads the same shop and operation; any change in name or Gmail conflicts
   before touching a Shop database. Status and Resume require a current
   Super Admin session and the original operation scope.
3. Reuse #717's pending-attempt and attributed-receipt checks. Its installer
   journal uses Node filesystem APIs, so the M03 owner must approve the
   shared execution and journal boundary before adapting it for Workerd.
   Test interruption and retry against a disposable local provider.
4. Apply and verify the pinned baseline against the exact Shop identity
   using #719's local proof. Verify a swapped binding stops readiness.
   Complete readiness and one local Gmail approval atomically in Control
   D1. Exercise interruption, repeat migration, duplicate invitation
   prevention, and lost responses with D1 readback.
5. Verify the original Control Center shows the exact safe failure stage
   and resumes the same operation after reload. Cover invalid inputs,
   unauthorized requests, changed intent and cross-shop selection. Run
   the new Workerd suite and full exact-head PR CI, then independent review.

Worker hosting, remote APIs, migrations against remote databases, and real
Owner access require separate approval. Run 1 uses disposable resources only.
