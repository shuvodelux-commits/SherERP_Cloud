# M02-P reviewed approval evidence preflight — Superpowers TDD plan

**Source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`
**Owner:** independent M02-P pure offline planner; no SQL/auth/shared posting kernel files.

1. [ ] **RED:** write `tests/contract/party-approval-evidence.test.mjs` with two disjoint synthetic reviewed groups and assertions rejecting reused/padded approvalRefs, non-UTC/impossible `reviewedAt`, padded `reviewedBy`; append one local workerd-D1 failure/no-write regression. Commit tests and capture actual failed GitHub CI.
2. [ ] **GREEN:** modify only `src/party/party-import-plan.js` with a local `Set` of previously used approval references and a deterministic UTC timestamp guard. Preserve member-key/overlap errors and exact original legacy ID outputs; no import DB writes.
3. [ ] Run GitHub Foundation full test suite, source integrity (84), frontend build, M02 local workerd D1, preserved-UI browser, and preview-safe CI. Inspect failed workflow logs; fix narrow behavior only.
4. [ ] Verify PR changed paths and latest `main` for overlaps, rebase if needed, recheck 100% CI, leave new PR open for review (never self-enable production import).
5. [ ] Record limitations: no M04 authenticated review, no D1 `approval_ref` persistence; parallel financial-module gate stays closed.
