# M02-P: Pending Party identity review counts (read-only design)

**Context:** `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/M03_PARALLEL_READINESS.md`, ADR-007. Original GAS SHA `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Current D1 migration `0002_party_identity.sql` already has `party_identity_review` with `OPEN`, `CONFIRMED`, `REJECTED` statuses and restricted reasons. The offline Party planner generates unresolved reviews but does not automatically approve/link.

## Contract
`summarizeOpenPartyIdentityReviews({DB})` (internal, never routed to public Worker) uses exactly one prepared **constant read-only SELECT**:
`SELECT reason, COUNT(*) AS count FROM party_identity_review WHERE status='OPEN' GROUP BY reason ORDER BY reason`.

Returns `{totalOpen: integer, byReason:[{reason,count},...]}`, alphabetical by reason; only the seven allowlisted reason labels and nonnegative safe integer counts are allowed. The zero-state response is `{totalOpen:0,byReason:[]}`. No raw source_group/source_id, names, phones, reviewer IDs, review IDs, candidate Party IDs, status transition details or SQL errors are returned. No user-controlled SQL identifiers/filters or caller-provided review decisions. Treat malformed or failed D1 responses as a generic error with no PII leak; avoid silent zero success.

## Security/consistency
- This is an internal migration diagnostic, **not** a routed API or business interface, and not proof a reviewer was authenticated.
- A single SELECT provides one SQLite statement snapshot; do not claim complete cross-table migration reconciliation or a transaction kernel.
- Test with genuine Cloudflare local workerd/D1: terminal reviews excluded, OPEN counts grouped correctly, and no effect on `parties`, `party_roles`, `party_legacy_links`.
- For an imported reviewed group, `approval_ref` is still not persisted in the current schema. Counting OPEN reviews does not make this gap disappear or activate cross-role settlements.

## Rejected alternatives
- Return full pending review records from an unauthenticated route (leaks identities and encourages bypass of M04).
- Automatically confirm/merge shared-name or shared-phone records.
- Modify the shared migration or import old Sheets data before M02/M03/M04 owner signoff.
