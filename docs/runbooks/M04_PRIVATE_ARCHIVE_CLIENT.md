# M04 — Verified historical staff archive to trusted private import client

**Status: CODE PREPARATION ONLY — NO REMOTE STAFF IMPORT AUTHORIZED.**
**Depends:** merged M04 private loopback-only operator PR #636, original D1 auth-only migrations 0001–0004, M03 issue #22, M04 issue #23, M11 issue #306. This is not public login or production launch.

## Historical Administrator and mobile identity

The source-compatible `src/auth/staff-phone-identity.js` normalizes the original ten-digit Bangladesh staff mobile to the canonical eleven-digit `phone_key`, including the initial zero. Private read-only checks of the verified historical staff archive found **exactly one Active Administrator** matching the owner's stated prior eleven-digit login number after this normalization. The raw source value is not placed in GitHub. This is **not** a Party identity match and does not create or edit a staff account. Existing private staging D1 still had **zero auth users/roles/sessions/legacy credentials** when last read; a migrated login is therefore not yet usable.

## Client behavior

The new Node-only script `scripts/m04-private-archive-client.mjs` contains:

- `readVerifiedPrivateM04ArchiveTwoPass(absoluteArchivePath)`: requires a non-symlink, mode-0600 owner-owned archive outside the GitHub checkout; opens the frozen SQLite **read-only twice**, verifies the existing M02 whole-archive row/workbook hashes through the merged M04 extraction helper, converts archived Excel serials using the original source's provisional Asia/Dhaka projection, and invokes the strict merged M04 Administrator-first partial source preflight. It returns private in-memory snapshots and a redacted report; it writes no source or remote data.
- `makePrivateM04StaffIntent(first,confirmation)`: validates two disjoint complete historical Users/Roles captures; restricts importable subset to two valid original staff and two roles, leaving exactly the one Active historical Owner deferred with unmodified ID/phone/status. This is a source freeze **consistency** check, not proof of distinct source exports.
- `submitApprovedPrivateM04StaffImport(...)`: requires the trusted caller to attest specific, separately reviewed M03/M04/M11 operator, provenance, pre-import backup/restore, bookmark and exclusive-writer gates; securely loads a one-use token from the mode-0600 operator file; issues exactly **one** capped-size authenticated POST to the fixed literal loopback URL `127.0.0.1:8787` with no redirect, no retry and no login/identity values in the response. It calls the merged #636 private operator, which controls the actual SQL-atomic D1 batch. Any failed/uncertain response is a hard stop requiring D1 readback before further action.

The client does **not** have an `--apply` CLI flag. Its only command is:

```bash
node scripts/m04-private-archive-client.mjs --verify-archive /path/to/owner-private-historical-archive.sqlite
```

This command performs **no remote writes**, prints **only counts and blocked flags**, and deliberately returns `independentlyCapturedSourceAttested:false`, `originalSpreadsheetTimezoneAttested:false`, and `remoteImportAuthorized:false`. These flags are truthful even when two connections to the **same** verified frozen archive return matching rows. It does not prove two separate exports from the authoritative Google Sheet.

## Manual protected operation — later gate

1. M03/M04/M11 independently review the exact-head CI, #636 private transport, this client and the source attestation. No M04 process owns shared `src/db/**`, migrations, `src/rpc/**` or production Worker/finance posting.
2. Confirm the definitive original Google Spreadsheet revision/source-to-workbook lineage and **its timezone**, rather than assuming related sheets with Asia/Dhaka metadata are the original. Approve the independent source capture/freeze procedure and state which snapshot is authoritative. Only then mark `independentlyCapturedSourceApproved` and `originalSpreadsheetTimezoneAttested` as externally justified. Boolean parameters do not independently prove human approvals.
3. Before any actual D1 write, confirm selected Cloudflare account, exactly one operational staging D1 UUID, migration ledger 0001–0004, no auth rows, current private SQL export restored with SQLite integrity, fresh Time Travel bookmark, approved recovery operator, and no concurrent writer. Protect source rows, hashes and tokens outside GitHub.
4. Prepare the one-time config using merged `prepare-m04-private-staging-operator.mjs`. Any local `wrangler dev` must use only loopback and one remote:true operational binding; never `wrangler dev --remote`, a public Worker, a preview D1 route, the history archive or the root 14-file migration queue.
5. In a trusted, explicitly approved operator process, invoke the single-submit library only after all reviewed evidence exists. **Never** put source staff credentials in command arguments, standard output, PR comments, CI logs or a public endpoint. Never automatically retry an uncertain import.
6. Immediately read back exactly **two** authenticated staff Users, **two** source Roles and **two** guarded pending legacy credentials, with **zero sessions**, zero throttle records and unchanged original Party/Owner/history rows. Cross-check each source identity privately, and create a new backup. An unexpected count or provenance mismatch is STOP, not permission to modify the original source.
7. Genuine first-login password verification/upgrade, authenticated private UI login, and an audited Administrator-authorized Owner phone claim are **subsequent** M03/M04 gates. Do not expose public login or financial postings to finish this task.

## Superpowers evidence

- RED: protected archive client tests introduced before the helper; the new imported module is absent.
- GREEN: minimal Node client delegates to merged source verification, exact M04 Administrator-first validation and private operator. Six focused Node cases verify malformed archive, historical phone representation, Owner preservation, missing approvals, unsafe token modes, one-shot fixed destination and safe failure without retry. GitHub M04 Workerd workflow includes this suite; exact-head CI and independent review required.
- No real staff values, phone numbers, legacy verifier, token or SQL dump were committed.
