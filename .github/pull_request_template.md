## Required workstream metadata
Workstream: M__
Issue: #__
Base main SHA: 
Depends-on (PRs/contract version): 
File owner (one lane or M03 shared integrator): 
Files changed / shared-file owner approval:
Read/write scope: docs | isolated tests | read-only internal | source-affecting | transaction writer
Affected source functions, RPC methods, SQL tables and original IDs: 
Source baseline (Mohim_ERP commit): 29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2

## Superpowers acceptance / evidence
Plan + owner-approved 10–15 sentence module overview:
RED failing test and exact commit/run:
GREEN passing test and exact commit/run:
Node/unit and local real Workerd/D1 check links:
Original browser/print parity (if affected):
Relevant financial/account, auth, Cash Session, replay and rollback invariants:

## Coordination / merge gate
- [ ] Scoped branch from fresh main; one owner for each shared file
- [ ] No unreviewed change to src/db, migrations, src/rpc, src/index.js, Worker binding, shared posting kernel or original UI
- [ ] Parent dependencies merged **into main** (or explicitly blocked/stacked)
- [ ] Current-head full CI green; all required reviewers and conflicts resolved
- [ ] No remote D1/private data write or public financial RPC without owner authorization
- [ ] Source references and release effect documented
- [ ] If this PR materially changes MVP/release progress, dependencies or next tasks, update `PROJECT.md` (otherwise explain why no handoff change is needed)
Merge sequence / parent integration PR:
Rollback/roll-forward plan (financial/schema changes):
Post-merge main SHA and required file presence:

See docs/PARALLEL_EXECUTION.md and AGENTS.md. Tick only after actual verification; template completion is not automatic approval.
