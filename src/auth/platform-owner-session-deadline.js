// One server-owned absolute deadline for the private pilot Owner bearer token.
// Workerd/SQLite evaluates the clock inside D1; browser clocks are untrusted.
export const OWNER_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
const NOW_SQL = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";
export const OWNER_SESSION_FRESH_SQL = `s.issued_at_ms > 0
  AND s.issued_at_ms <= ${NOW_SQL}
  AND s.issued_at_ms > ${NOW_SQL} - ${OWNER_SESSION_MAX_AGE_SECONDS * 1000}`;
