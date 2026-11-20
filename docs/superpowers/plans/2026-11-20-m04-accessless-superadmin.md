# M04 — Independent Google/TOTP Super Admin boundary (Access-less pilot)

**Status:** local-only security candidate; not deployed; production release NO-GO.
**Base:** `main` at `24523d589e86c2252896a4770743f82ae41931e4`.
**Coordinator:** M04 auth contract, with M03 owning hosted Worker/config/D1 integration.
**Issue:** [M04 #23](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/23).

## Scoped overview

1. The operator needs `https://admin.hisab.workers.dev` for Super Admin but cannot finish Cloudflare Zero Trust onboarding without a payment card.
2. The existing Access-protected M03 Admin Worker remains unchanged and retains its native Access identity contract.
3. A separate M04 entrypoint provides an **explicit opt-in** alternative that does not use `ctx.access` or client-supplied Cloudflare Access headers.
4. It reuses the existing private Hono Admin application and the **same** original Google sign-in page and CSS.
5. It requires a trusted exact `workers.dev` origin and a preapproved stable Google **subject**, not a browser-supplied email.
6. If Control D1 has enrolled an administrator, the stored issuer and subject must match that preapproval on every request.
7. Before enrollment, only the original protected one-time, Google-subject-bound setup flow is permitted; no normal session is possible.
8. The existing signed Google ID-token verifier requires trusted audience, nonce, verified email, issuer and subject.
9. The existing TOTP verifier, SQL-backed one-time challenge, short-lived sessions and logout revocation are reused, not replaced.
10. Both the outer ingress rate limit and existing D1-backed throttling continue to apply, with wrong origins rejected first.
11. With any missing credential, D1 binding, trusted subject, feature mode or factor configuration, requests fail closed.
12. The public `shererp` Worker remains database-free and Owner authentication remains a separate M03 integration task.
13. No live schema writes, secrets, D1 migrations, Worker deployments or staff/financial posting are included in this PR.
14. The hosted migration, approved ticket issuer, MFA enrollment, rollout and rollback require M03/M04/M10/M11 independent review and release approval.

## Files and contract impact

- `src/auth/m04-accessless-platform-admin-worker.js`: new optional Admin entry; no shared public Worker entry edits.
- `tests/m04-accessless-platform-admin.test.mjs`: RED/GREEN source/negative security contract.
- `tests/integration/m04-accessless-platform-admin-workerd.spec.mjs`: disposable **local** Workerd/D1 proof only; synthetic bootstrap row never used remotely.
- This plan: records the new opt-in contract.
- No changes to `src/db/**`, numbered migrations, `src/index.js`, `src/rpc/**`, `wrangler*.jsonc`, original frontend, or existing Access entrypoint.

## Required trusted hosted configuration (NOT a deploy command)

| Name | Requirement |
| --- | --- |
| `PLATFORM_AUTH_MODE` | Exact string `google-totp-without-access`; absent by default |
| `PLATFORM_AUTH_SCOPE` | `private-platform-auth` |
| `PLATFORM_AUTH_ORIGIN` | Exact `https://admin.hisab.workers.dev`, after confirming correct account |
| `PLATFORM_CLIENT_ID` | Reviewed Google Web client ID with exact authorized browser origin |
| `PLATFORM_OPERATOR_GOOGLE_SUBJECT` | Independently verified first Admin Google stable subject (digits), not email or a client-provided claim |
| `PLATFORM_TOTP_SECRET` | Protected 20-byte TOTP key, 40 lowercase hex characters, stored **only in Worker secrets** |
| `PLATFORM_FACTOR_VERSION` | Positive integer factor version matching Control D1 |
| `PLATFORM_INGRESS` | Live rate-limit binding; outer gate runs before any SQL |
| `CONTROL_DB` | Exact reviewed Control D1 binding; never attached to the public ERP Worker |

Do not copy existing-account Wrangler IDs, paste secrets into GitHub or enable optional Shop/Owner/financial feature switches by default.

## Test-first and release sequence

1. **RED:** test import fails when new independent M04 entrypoint is absent.
2. **GREEN:** add opt-in wrapper using existing auth runtime, fixed allowed origin and D1 subject proof.
3. **RED:** negative rate-limit case fails without pre-D1 admission control.
4. **GREEN:** rate-limit before D1.
5. **QA:** local Workerd with disposable Control D1; wrong origin/mode/subject, forged headers, unknown ticket, unsigned Google credential and no elevated session must all fail.
6. **Independent review:** verify body bounds, client-hint rejection, one-time subject-bound setup, TOTP replay protections, no accidental auth bypass and native-Access regression.
7. **Release remains blocked:** owner-approved remote Control migrations, secure verified subject capture and ticket issuance, independent security review, Cloudflare build ownership, and M10/M11 GO.
8. **Only after approval:** M03 releases the private hosted Admin profile and verifies real-login browser tests; no direct live D1 change in this workstream.

**Remaining limitation:** This change alone cannot make the Hello World hostname an ERP Control Center. The missing approved hosted D1 migration, first-admin operator bootstrap and Worker release pipeline must be completed separately.
