# M11-16 — GitHub main branch-protection release governance blocker

**Date:** 2026-11-17. **Workstream:** M11. **Issues:** #306 and #456. **Base:** `main@7c81dca09f975fbda37586eb50c2763c7f8506df`. **Source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Twelve-sentence overview

1. The owner requires full exact-head GitHub Actions and review before merging any SherERP module PR.
2. The M11 workflow-source audit has already been merged into main and checks that PR workflows do not deploy or write remote D1.
3. That static audit does not verify actual GitHub repository branch protection.
4. A read-only live GitHub Branch API request on 2026-11-17 returned `protected:false` for `main` and required status-check enforcement `off`.
5. The repository rulesets listing returned an empty list, while the detailed protection endpoint returned a permission-limited 403.
6. An unprotected default branch can accept direct pushes or merges that do not enforce the owner's test/review policy.
7. The first scope is a dated, evidence-backed release governance blocker added to the M11 owner decision matrix.
8. The existing cutover runbook will link to this blocker with an explicit stop condition for release signoff.
9. The remediation belongs to an authorized GitHub repository administrator and requires an active rule targeting main, PR reviews and required status checks.
10. Once configured, a separately authorized read of branch/ruleset settings must prove enforcement and the real GitHub staging environment approvals must be independently inspected.
11. No M11 code, GitHub Actions, Cloudflare deployment, protected repository policy, D1 schema, public RPC, staff export or original GAS/Sheets will be modified by this PR.
12. Documentation-only work is exempt from artificial RED tests, but full exact-head CI, KISS, review and verified integration to main still apply.

## Evidence and owned scope

- **Actual source evidence:** `GET /repos/shuvodelux-commits/SherERP_Cloud/branches/main` response on 2026-11-17 included `protected:false` and `protection.enabled:false`, `required_status_checks.enforcement_level:"off"`, `contexts:[]`, `checks:[]`.
- **Access limitation:** Detailed branch-protection API returned 403 `Resource not accessible by integration`; environment-policy API unavailable through this connection. Do not mistake this for proof of Cloudflare/GitHub environment misconfiguration.
- **Module-owned changes:** `docs/runbooks/M11_RELEASE_READINESS_MATRIX.md`, `docs/runbooks/M11_PRODUCTION_CUTOVER.md`, and this M11 plan.
- **Read only:** `AGENTS.md`, `docs/PARALLEL_EXECUTION.md`, coordination issue #456, M11 issue #306, GitHub branch/ruleset settings API.
- **No new functions, RPC methods, SQL tables, source IDs, financial postings, D1 migrations, Worker/CI changes or Cloudflare API calls.**
- **Dependencies:** M10 private real-data rehearsal and all other M03/M04/M05–M09 gates remain blocked; finding is independently relevant to safe PR governance.
- **TDD:** N/A documentation-only; the evidence is a real read-only GitHub control-plane observation rather than a synthetic unit-test assertion.
- **Acceptance:** Document current unprotected status as dated observation, explicit branch-rule remediation, verification criteria, and continue to hold production NO-GO.
- **Merge:** PR to main; no merge until complete exact-head Actions and required review. **Rollback:** revert the three documentation-only changes. No customer or production rollback impact.
