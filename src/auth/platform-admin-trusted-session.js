/**
 * Admin trust is scoped to a cryptographically random, HttpOnly, same-site
 * server session on THIS browser. IP address, user-agent, localStorage and
 * client-side device IDs do not constitute trusted-device authentication.
 *
 * Fixed absolute lifetime (no silent sliding extension).
 */
export const PLATFORM_ADMIN_TRUSTED_SESSION_DAYS=15;
export const PLATFORM_ADMIN_TRUSTED_SESSION_MS=
  PLATFORM_ADMIN_TRUSTED_SESSION_DAYS*24*60*60_000;
export const PLATFORM_ADMIN_TRUSTED_SESSION_SECONDS=
  PLATFORM_ADMIN_TRUSTED_SESSION_MS/1000;
