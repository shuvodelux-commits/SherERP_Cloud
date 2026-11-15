/**
 * M04 internal-only session time/revocation eligibility predicate.
 *
 * This is not authentication: callers must obtain the session from D1 using
 * a trusted token digest, verify user/role/permission and honor atomic
 * revocation. No live auth endpoint currently imports this module.
 */
const validObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const epochMs = (v) => Number.isSafeInteger(v) && v >= 0;
const durationMs = (v) => Number.isSafeInteger(v) && v > 0;

function ownValue(obj, key) {
  const descriptor = Object.getOwnPropertyDescriptor(obj, key);
  return descriptor && Object.hasOwn(descriptor, 'value')
    ? descriptor.value
    : undefined;
}

/**
 * Evaluate candidate session timestamps with EXPLICIT, server-owned policy.
 *
 * @param {unknown} session - future D1 row: createdAtMs, lastActivityAtMs,
 *   expiresAtMs and revokedAtMs (must be exactly null for active).
 * @param {unknown} policy - maxLifetimeMs and maxIdleMs, positive integers.
 * @param {unknown} nowMs - trusted server clock, Unix milliseconds.
 * @returns {boolean} A necessary, never sufficient, auth condition.
 */
export function isSessionWithinPolicy(session, policy, nowMs) {
  if (!validObject(session) || !validObject(policy) || !epochMs(nowMs)) return false;

  try {
    const createdAtMs = ownValue(session, 'createdAtMs');
    const lastActivityAtMs = ownValue(session, 'lastActivityAtMs');
    const expiresAtMs = ownValue(session, 'expiresAtMs');
    const revokedAtMs = ownValue(session, 'revokedAtMs');
    const maxLifetimeMs = ownValue(policy, 'maxLifetimeMs');
    const maxIdleMs = ownValue(policy, 'maxIdleMs');

    if (!epochMs(createdAtMs) || !epochMs(lastActivityAtMs) ||
        !epochMs(expiresAtMs) || revokedAtMs !== null ||
        !durationMs(maxLifetimeMs) || !durationMs(maxIdleMs)) return false;

    if (lastActivityAtMs < createdAtMs || lastActivityAtMs > nowMs ||
        createdAtMs > nowMs || expiresAtMs <= createdAtMs ||
        nowMs >= expiresAtMs) return false;

    // Subtract only after validating ordered, safe-integer epochs; never
    // add unbounded durations or quietly extend a source 'Never' session.
    return expiresAtMs - createdAtMs <= maxLifetimeMs &&
      nowMs - createdAtMs < maxLifetimeMs &&
      nowMs - lastActivityAtMs < maxIdleMs;
  } catch {
    // Proxy/accessor failures must never become authenticated success.
    return false;
  }
}
