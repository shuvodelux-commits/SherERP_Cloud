/**
 * M04 internal-only, deterministic login-throttle policy state machine.
 *
 * Original Auth.gs: 5 failed logins -> 15-minute lockout with 1-hour
 * CacheService state TTL. This reducer itself protects NOTHING: a future
 * public login implementation must perform DB-backed record lookup,
 * credential checks and failure/success transitions atomically.
 *
 * Never interpret a failed persistence read as prior === null. Only a
 * successful query confirming no record can pass null here.
 */
export const LEGACY_LOGIN_LIMITS = Object.freeze({
  failureLimit: 5,
  lockoutMs: 15 * 60_000,
  resetAfterMs: 60 * 60_000,
});

const isEpochMs = value => Number.isSafeInteger(value) && value >= 0;

function checkedOffset(start, duration) {
  const result = start + duration;
  if (!Number.isSafeInteger(result)) throw new RangeError('Login throttle clock overflow');
  return result;
}

function readPrior(prior, nowMs) {
  if (prior === null) return null;
  try {
    if (!prior || typeof prior !== 'object' || Array.isArray(prior))
      throw new TypeError('Invalid login throttle state');
    const prototype=Object.getPrototypeOf(prior);
    if (prototype!==Object.prototype && prototype!==null)
      throw new TypeError('Invalid login throttle state prototype');

    const read=key=>{
      const descriptor=Object.getOwnPropertyDescriptor(prior,key);
      if(!descriptor || !Object.hasOwn(descriptor,'value'))
        throw new TypeError('Invalid login throttle state field');
      return descriptor.value;
    };
    const failureCount=read('failureCount');
    const lockedUntilMs=read('lockedUntilMs');
    const lastFailureAtMs=read('lastFailureAtMs');
    const resetAtMs=read('resetAtMs');

    if (!Number.isSafeInteger(failureCount) || failureCount<1 ||
        failureCount>LEGACY_LOGIN_LIMITS.failureLimit ||
        !isEpochMs(lockedUntilMs) || !isEpochMs(lastFailureAtMs) ||
        !isEpochMs(resetAtMs) || lastFailureAtMs>nowMs ||
        resetAtMs-lastFailureAtMs!==LEGACY_LOGIN_LIMITS.resetAfterMs)
      throw new TypeError('Inconsistent login throttle state');

    if (failureCount===LEGACY_LOGIN_LIMITS.failureLimit) {
      if(lockedUntilMs-lastFailureAtMs!==LEGACY_LOGIN_LIMITS.lockoutMs)
        throw new TypeError('Inconsistent throttle lockout');
    } else if(lockedUntilMs!==0) {
      throw new TypeError('Unexpected throttle lockout');
    }
    return {failureCount,lockedUntilMs,lastFailureAtMs,resetAtMs};
  } catch {
    // A storage/proxy error is never equivalent to a missing throttle row.
    throw new TypeError('Invalid login throttle state');
  }
}

/**
 * Evaluate one event against a trustworthy, successfully read server record.
 *
 * @param {object|null} prior - null ONLY after a confirmed absent DB row.
 * @param {'inspect'|'failure'|'success'} event - validated server event.
 * @param {number} nowMs - trusted server time in Unix milliseconds.
 * @returns {{blocked:boolean, state:object|null}}
 */
export function transitionLoginThrottle(prior,event,nowMs) {
  if (event!=='inspect' && event!=='failure' && event!=='success')
    throw new TypeError('Unrecognized login throttle event');
  if (!isEpochMs(nowMs)) throw new TypeError('Invalid login throttle timestamp');

  let state=readPrior(prior,nowMs);

  // The old cache expires an hour after its last update. Its lockout is
  // cleared before attempting another password at the expiry boundary.
  if(state && (nowMs>=state.resetAtMs ||
      (state.lockedUntilMs!==0 && nowMs>=state.lockedUntilMs))) {
    state=null;
  }

  if(state?.lockedUntilMs>nowMs) return {blocked:true,state};
  if(event==='inspect') return {blocked:false,state};
  if(event==='success') return {blocked:false,state:null};

  const failureCount=(state?.failureCount ?? 0)+1;
  const lockedUntilMs=failureCount>=LEGACY_LOGIN_LIMITS.failureLimit
    ? checkedOffset(nowMs,LEGACY_LOGIN_LIMITS.lockoutMs)
    : 0;
  const resetAtMs=checkedOffset(nowMs,LEGACY_LOGIN_LIMITS.resetAfterMs);

  return {
    blocked:lockedUntilMs>nowMs,
    state:{failureCount,lockedUntilMs,lastFailureAtMs:nowMs,resetAtMs},
  };
}
