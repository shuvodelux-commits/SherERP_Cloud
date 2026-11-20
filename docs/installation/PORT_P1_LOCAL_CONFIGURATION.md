# PORT-00 P1 — Portable Cloudflare instance configuration (local drafts)

**Status: review candidate. No deployment approval, no provisioning, no remote migrations, no public Worker binding.** This step makes configuration independent of one Cloudflare account. It does **not** make the full ERP or shop onboarding production-ready; follow [the portability roadmap](PORTABILITY_ROADMAP.md), issue [#699](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/699), M03/M04 authorization and M10/M11 release gates.

## What P1 does

- Validates a strictly versioned, minimal instance manifest (Cloudflare account ID, Workers subdomain, two distinct Worker names/exact origins, public Google OAuth Web client ID, Control D1 + one **pilot** Shop D1 IDs, Shop ID/marker, separate rate-limit namespace IDs).
- Generates two separate Wrangler **local drafts** in the existing Git-ignored `.wrangler/portable-instance/` directory: `admin.generated.jsonc` and `owner.generated.jsonc`. It does not change checked-in Wrangler profiles, migrations or frontend code.
- Uses the existing private Hono/Owner runtime and one reviewed, static `PLATFORM_PILOT_DB` binding only. Automatic provisioning of multiple shops, Worker-binding publication, and safe retries still belong to P4/#690. Do **not** interpret a pilot draft as a dynamic multi-tenant solution.
- All generated Workers have `workers_dev:false` and `preview_urls:false`; source activation switches are **off**, and D1 bindings have `remote:false`. These files are **not deployment-ready** and deliberately do not include Access audience/operator, session/MFA, API credentials or other protected configuration.
- Set the optional top-level `"adminAuthMode": "google-totp-without-access"` to select the reviewed Google/TOTP Admin Worker from [PR #806](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/806). It requires an exact trusted Admin origin, a preapproved Google subject, a one-time Control D1 setup ticket and TOTP. Configure the subject, TOTP key and factor version separately through approved Worker configuration. If you omit the field or set it to `"cloudflare-access"`, the installer selects the existing Access profile.

## Local instructions — no cloud changes

1. Use the latest reviewed GitHub branch. Do not change an existing production/staging Cloudflare account for this exercise. Keep the original `wrangler.preview.jsonc` database-free.
2. Copy the checked-in **invalid-on-purpose example** to the ignored local instance area:
   ```bash
   mkdir -p .wrangler
   cp docs/installation/INSTANCE.example.json .wrangler/instance.json
   ```
3. Edit `.wrangler/instance.json` with **fresh-account** identifiers and the intended private Worker names and exact HTTPS `workers.dev` hosts. The two origins must be `https://<worker>.<subdomain>.workers.dev`. All UUIDs must be real, distinct UUIDv4 values from approved setup evidence. The Google client ID is a **public** Web OAuth client identifier, not a client secret. Do not insert Access credentials, API tokens, passwords, TOTP seeds or customer data.
4. Validate without creating anything:
   ```bash
   node scripts/port-p1-instance.mjs --check .wrangler/instance.json
   ```
   It fails closed on placeholders, missing or unexpected keys, duplicate resources, origin mismatches, invalid IDs or an unsafe public preview.
5. Generate the **inactive local drafts**:
   ```bash
   node scripts/port-p1-instance.mjs --generate .wrangler/instance.json
   ```
   Repeat with the same values to confirm idempotency. A changed manifest does **not** silently replace previously generated profiles; review and explicitly archive the old ignored drafts before generating an updated instance.
6. Inspect the generated **local** profiles for the intended account, Worker names and bindings. **Do not run `wrangler deploy`, `wrangler d1 migrations apply --remote`, or activate private release flags from these drafts.**

Use [P2 read-only preflight](PORT_P2_READONLY_PREFLIGHT.md) to confirm the Control and Shop D1 identities against the intended account before preparing release configuration. Google OAuth, the selected Admin authentication setup, migrations, backup and deployment each have separate release gates.

## Review/test evidence

```bash
node --test tests/contract/port-p1-instance.test.mjs tests/m03-platform-access-workers-dev.test.mjs tests/contract/port-p0-inventory.test.mjs
node scripts/port-p0-inventory.mjs --check
npm run verify:source
```

The P1 contract tests prove local manifest validation, output isolation, file-mode and retry behavior. The private Administrator test exercises exact-host and native Access denial with the existing Worker. They are **not** proof of a real second-account Cloudflare installation. M03 still owns runtime/Worker D1 changes; M11 must separately approve deploy protection and M10 must approve data migration. See the release matrix before enabling any ERP write.
