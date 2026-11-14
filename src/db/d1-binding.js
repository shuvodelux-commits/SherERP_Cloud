/** M03: fail closed when the isolated Worker has no D1 binding. Never open a fallback DB. */
export function requireD1Binding(env) {
  if (!env?.DB || typeof env.DB.prepare !== 'function') {
    throw new Error('D1 database binding unavailable');
  }
  return env.DB;
}
