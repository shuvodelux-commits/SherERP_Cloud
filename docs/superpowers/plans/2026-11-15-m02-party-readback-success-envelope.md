# M02-safe — Party D1 readback success-envelope TDD plan

**Target:** `src/party/d1-identity-readback.js`; `tests/integration/m02-party-plan-workerd.spec.mjs`.

## Task 1 — RED
Append one regression to existing actual Workerd/D1 Party plan suite. Use valid current frozen synthetic import plan, real `DB.prepare` and `DB.batch` SELECT-only queries to obtain actual 3-row readback. Wrap the batch responses to change exactly one result's `success` property to missing, null, 0, 1, string or false. Verify each is rejected with generic redacted readback error and that 4 Party / 7 role / 5 legacy-link counts remain untouched. Verify true statuses proceed to existing `APPROVAL_REF_NOT_PERSISTED` blocking result. Commit RED test before implementation; GitHub M02 local-D1 workflow should fail on the first incomplete status.

## Task 2 — GREEN
Replace permissive `row.success===false` in the adapter with strict `row.success!==true`; do not change query list, SQL identifiers, schema, error response or write any D1 record.

## Task 3 — Verification
Use GitHub CI RED/GREEN evidence (M02 Party synthetic Workerd, Foundation, M03/M04 integrations, Chromium preview safety); run source manifest verification (84 originals) and Node test suite. Merge only after all current-head checks are green and owner review. Record blocker: no approved `approval_ref` persistence/M04 reviewer authorization, no production import.
