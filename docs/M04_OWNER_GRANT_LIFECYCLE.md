# Owner write grants for the private pilot candidate

Run 1 of #690 builds on #701–704. The private Owner sign-in and logout paths
and the private platform disable-owner action use one verified Shop binding.
A product writer still requires separate review. All checked-in deployment
profiles leave OWNER_WRITE_GRANTS_ENABLED unset.

## State and ordering

1. Control D1 issues a unique current Owner token and advances the existing
   session generation. Only a digest is persisted.
2. Before sending a grant to Shop D1, reserve that exact digest and generation
   in platform_owner_grant_claim under the current membership and binding.
   Control triggers reject session deletion, replacement or rotation while a
   claim exists. This also guards the existing access-disable trigger.
3. Shop D1 enables a higher generation under the matching shop ID, database
   ID and marker. Repeating the same active grant succeeds. A disabled
   generation cannot become active again.
4. To remove or replace the session, write its disabled generation to the
   verified Shop first. This applies even when publication has yet to arrive.
   Confirm the Shop fence, then release the matching Control claim. Finish the
   original authenticated Control action. If concurrent publication creates
   another claim, the SQL guard aborts the transition. Retry the action.
5. An interrupted logout returns 503 and retains the browser cookies for
   retry. A failed login can start a new Google challenge. A failed disable
   can be retried by the current platform administrator. The disabled Shop
   fence survives interruptions and repeated requests.

## Private rollout and recovery

Use a verified empty staging shop after separate release approval. Verify
both database UUIDs and markers and take recovery points first. Shop identity
and shop-owner-write/0002 must exist. Apply the Control onboarding chain
through 0008, then platform-owner-write/0009 and 0010 in order. Previously
issued sessions without a generation require fresh sign-in. Start with the
Shop grant disabled and verify there is no previously published/untracked
grant. Enable the candidate flag only on the paired private Owner and
platform Workers after schema and binding checks.

The private platform POST /api/platform/shops/disable-owner requires the
current Super Admin cookie, same origin and the configured shop ID. It
disables Owner access and cancels Owner sessions and challenges. Platform-wide
tenant lifecycle and support sessions are separate milestones.

To roll back, fence grants through the current candidate and verify disabled
Shop state and empty Control claims before reverting the Workers or removing
the flag. Retain generation history and the migration. If either database is
unreachable, keep tenant writes closed until reconciliation. After any
restore, fence writes, reconcile the two recovery points and invalidate prior
sessions before serving requests.
