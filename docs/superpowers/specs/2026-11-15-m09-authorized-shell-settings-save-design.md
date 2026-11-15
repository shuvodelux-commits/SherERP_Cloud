# M09 — Authorized source-shaped single-key Shell Settings save

Date: 2026-11-15. Frozen source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2, Settings.gs::updateSettings and Utils.gs::sanitizeInput_. Repository rules: AGENTS.md, docs/WORKSTREAMS.md, docs/MIGRATION_PLAN.md, ADR-007. Depends on merged M09 source preflight PR #239.

## Objective and original source contract

Implement a small INTERNAL adapter that combines M09 source validation with the existing M04 guarded SQL update, and nothing else. Only Shop Name and Currency Symbol are currently approved by the existing M04 writer. The original Settings page supports 30 keys and multi-field updates; those are NOT enabled here. No publicly accessible Settings RPC is added, and the source HTML remains unchanged.

Create createM09AuthorizedShellSettingsSave(env).saveOne(request), accepting an exact own-data request object with token, nowMs, key, newValue and expectedValue. Only the two M04 approved string keys are accepted. Reject accessors, inherited values, unexpected keys, non-string values, unsafe clocks and invalid tokens without reading getters or preparing SQL. Source preflight planSettingsUpdate({[key]:newValue}) controls the Shop Name required/trim behavior and Currency Symbol Unicode trim. If it reports Shop Name required, return the original source failure envelope before SQL. Otherwise pass the one normalized key/value and old-value preimage to createM04AuthorizedShellSettingsUpdateAdapter(env).updateExisting_() and return the original Settings saved success envelope only **after** the guarded D1 CAS confirms an update. Denied, stale and uncertain outcomes must reject without claiming success. Do not use an unguarded read, recheck permissions in JS before updating, retry a failed CAS, or create absent rows.

M04's fixed SQL UPDATE simultaneously enforces current settings.edit boolean role grant, token/session existence, expiry and idle limits, user credential and role epochs, key existence and exact old-value preimage. Never duplicate the M04 authorization SQL or change M04 code in this slice. The M04 isolated test auth schema still lacks tenant_id: ONLY single-business local test D1 is allowed, not production, public preview, or shared tenant. No Bank/Finance/Party writes, logo storage, multi-key batch, or user-visible Settings save activation.

## Test and acceptance

Write original unmodified GAS Settings.gs::updateSettings Node VM source-oracle tests plus real Node SQLite M02 Settings/M04 auth fixture tests before implementing. Assert source-equivalent normalization and success/error envelopes; one guarded SQL only on approved writes; stale/absent preimage, concurrent double submit, revoked/expired/edit-only roles and invalid request never change rows. Add dedicated PR-only/no-secrets real Workerd+D1 test workflow for the same behavior with original test-only M04 schema. Verify original source manifest (84 files), original UI assembly (36 includes), browser desktop/mobile/A4, and no public RPC or DB binding.

## Files/rollback/gates

Exactly six new files: spec, plan, src/modules/m09-authorized-shell-settings-save.js, tests/m09-authorized-shell-settings-save.test.mjs, tests/integration/m09-authorized-shell-settings-save-workerd.spec.mjs, .github/workflows/m09-authorized-shell-settings-save-workerd.yml. No original GAS/HTML, shared M04, schema, Worker, RPC or production data changes. Revert six files to roll back.

Future gated work: approved tenant-scoped M04 auth, all-30-key multi-field atomic Settings update, source Bank Account verification, insertion semantics, and full original UI/RPC integration. This internal one-key proof is not that feature.
