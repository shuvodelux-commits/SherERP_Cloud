# M09 Settings update preflight — frozen source contract

Date: 2026-11-15. Source: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `legacy/source/Settings.gs::updateSettings`, `SETTINGS_EDITABLE_KEYS`, `SETTINGS_NUMERIC_KEYS`, `SETTINGS_BOOLEAN_KEYS`; `Utils.gs::sanitizeInput_` and `isValidNonNegativeNumber_`. Current `AGENTS.md`, M09 workstream and ADR-007 apply.

**Goal:** preserve the legacy Settings UI's partial-save validation and conversion before a separately authorized D1 Settings mutation is approved. Current M03/M04 authorized writes only cover narrow Shell Settings. This is a **pure internal, zero-I/O, zero-write preflight**, not an RPC, permission grant, bank-account lookup or full Settings updater.

**Function:** `planSettingsUpdate(payload, bankAccounts?)` returns `{success:true,data:'Settings saved.',writes:[{key,value}]}` or original source-shaped `{success:false,error:'...',writes:[]}` for original validation rejections. `writes` is an **ordered proposal**, not an executed mutation. Only 30 source allowlisted keys are emitted, in frozen list order, never client order, and only when the payload contains the key with a non-undefined value; partial updates never clear omitted settings. Reject unsafe user-input objects or selected-bank snapshots before returning any plan.

- Required Shop Name if present: `sanitizeInput_` is String then trim; empty is original exact error.
- Numeric keys: validate original `Number()` conversion is finite and >=0, except **exact empty string** skips validation and produces numeric 0. Trimmed whitespace also resolves numeric 0. Reject negatives, Infinity and nonnumeric text; source error names the field.
- Default Bank Account if truthy: use caller-provided **all-source** Bank Account records; original tests existence by exact `Bank Account ID`, **even if Status is Inactive**. No inference from mobile bank label, no automatic default, and no live balance reads. If bank source snapshot is missing/malformed, fail closed rather than claiming the ID was absent.
- Invoice Payment Methods and Invoice Terms: for nonblank `sanitizeInput_` values, JSON.parse must succeed to **array**. Preserve saved sanitized source text, including valid unicode/Bangla and exactly original failure text.
- Boolean keys: only actual `true` or literal `'true'` serialize `'true'`; all other valid scalars (including uppercase `'TRUE'`) produce `'false'`. Other fields use `String(value).trim()`.
- Unknown ordinary payload keys are ignored like source; fail closed on reserved/prototype/accessor/nonprimitive keys and Promise input, rather than triggering dangerous coercion. Do not add a new Settings whitelist to SQL.
- The preflight does **not** perform Bank Account permissions, roles, Cash/Bank movements, invoice logo uploads, settings writes, optimistic lock or user-facing success before an authorized D1 commit. M04 `settings.edit` in the same SQL CAS statement remains a future separate requirement; no preflight alone can authorize a write.

**Testing:** Execute **unmodified** frozen GAS `updateSettings` in Node VM with real source constants, sanitizeInput_/number helper, mocked LockService and getAllRows_, and intercepted `setSetting_`. Compare complete returned success/error, exact ordered write proposal, validation order, no partial writes on validation failures and no mutation of original payload. Test 30 source keys, numeric/boolean edge cases, JSON arrays, bank source status, unknown keys, and malicious inputs. RED Github CI prior to implementation then GREEN full original source/Worker suite.

**File inventory:** four new files only: this design, plan, `tests/m09-settings-update-preflight.test.mjs` and `src/modules/settings-update-preflight.js`. No modifications to GAS/HTML/RPC/D1 schema/auth, production Worker, Cloudflare binding, shared existing Settings update modules, or financial data.

Rollback: revert four files; no data migration.
