# M04 staging Google Sign-In design

This is the sign-in path from the SherERP authentication requirements. It keeps the existing Administrator and uses Google Identity Services for authentication in staging. Signup and tenant onboarding are outside this change.

1. Register a Google OAuth client for the exact approved staging origin and configure its public client ID in the staging Worker.
2. A same-origin endpoint creates a short-lived, unpredictable login challenge. Keep the challenge bound to the initiating browser and pass its nonce to Google Identity Services. Require the expected origin and the chosen Google CSRF protection when the browser submits the credential.
3. Before any session write, verify the ID token with Google's public key set, issuer, audience, lifetime and the challenge nonce. Resolve only the verified Google subject through an explicit trusted link. Existing Administrator linking requires recent SherERP reauthentication or a separately reviewed account recovery operation. A matching email cannot establish the link.
4. The M03/M04 session integration must atomically consume the challenge and recheck the active staff identity and its authorization epoch. Use an opaque ERP session that can be validated and revoked server-side. Preserve the original password verifier. Existing password session validation assumes a Modern credential, so the Google path for a legacy-pending account requires a reviewed provider-aware session contract before release.
5. The staged UI adds Google Sign-In through the existing login entry point. Tests must cover replay races, disabled or unlinked users, logout, session restore, forged assertions and direct access to unsupported RPCs. Public previews retain no secrets, auth writes or operational D1 binding.

The internal verifier in this slice handles step 3's token trust check. It returns only a canonical issuer and the stable subject. The caller owns one-time challenge consumption, trusted account linking, authorization, and session creation. These operations require the M03/M04 integration review and real D1/browser evidence before exposing a route.
