/**
 * Fail closed until M04 authentication and per-method authorization ship.
 * Adding handlers here without both policy enforcement and D1-backed tests is forbidden.
 */
export const rpcRegistry = Object.freeze(Object.create(null));
