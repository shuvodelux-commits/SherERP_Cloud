# Superpowers TDD plan — M09 Day Book frozen 12-group schema

1. Inspect `docs/baseline/schema-inventory.json` against pinned original `Config.gs`; capture twelve source group keys, original exact ordered headers, sheet name and original ID header. Include Cash/Bank historical ID-less caveat.
2. Commit this spec, plan and `tests/m09-daybook-source-schema-contract.test.mjs` first. Test exact mapping, all twelve group count/ordering, Ledger account separation, original header immutability, missing/duplicate/reordered/extra fields, accessor/prototype hazards, original source not mutated.
3. Open draft PR. Observe actual **RED on GitHub Foundation `npm test`** due missing exported implementation; log expected count and exit result, not a theoretical claim.
4. After RED, add one minimal pure module `src/modules/m09-daybook-source-schema-contract.js` with fixed reviewed headers for twelve source groups, validation of plain own-data inventory, strict exact heading arrays, immutable returned metadata.
5. Run actual exact-head GitHub Foundation + source integrity and other PR checks, confirm RED→GREEN with zero failing Node tests. Do not alter M04 authorization, D1, public RPC or posting.
6. Keep PR draft for owner review. Next work is explicit source provenance and tenant-bound D1 import schema, separately built and tested on isolated Workerd D1. Reject partial historical ledger as a valid transaction snapshot.
