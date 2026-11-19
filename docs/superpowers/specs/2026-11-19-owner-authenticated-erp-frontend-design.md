# Owner-authenticated ERP frontend design

## Intent

After Google sign-in at `owner-hisabiq`, open the existing SherERP frontend on that same origin so the Owner sees the ERP modules. The public `hisabiq` Worker remains an inert, database-free shell.

## Approaches

- Serve the existing frontend from the Owner Worker and validate its existing D1-backed Owner session on every app-shell request. This keeps the host-only cookie and shop binding in one origin; **selected**.
- Redirect to the public Worker. Rejected because its origin cannot validate the Owner host-only session and must not receive a shop D1 binding.
- Duplicate or redesign the ERP frontend. Rejected because it would diverge from the preserved source UI and add unnecessary maintenance.

## Scope and constraints

- Build the unchanged legacy HTML/CSS/JS into an Owner-specific asset directory and expose it only after Owner session validation.
- Use the authenticated session's shop metadata and the existing source-shaped navigation for the display shell.
- Keep the login experience on the Owner Worker. Successful session restore or login navigates to the ERP shell; sign-out uses the existing Owner logout endpoint.
- The frontend will state that business data is not connected. RPC methods other than the read-only app-shell projection and logout are rejected locally with a fixed unavailable message; the Worker adds no business RPC or write route.
- Do not alter the public Worker, shop schema/data, imported archive, or deployment credentials. No remote migration or business-data import is included.

## Acceptance

- Unauthenticated requests cannot retrieve the app HTML.
- An active Owner session can retrieve the ERP shell and source navigation for its bound shop.
- Missing, revoked, disabled, or wrong-shop sessions cannot retrieve it.
- Sign-in/session restore reaches the shell and logout returns to sign-in while revoking the server session.
- Unsupported module calls make no network request and expose no business data or write capability.
- The original UI source remains unchanged, and all business screens explain that their data/API is not connected.

## Remaining limitation

This connects the existing interface to Owner authentication; it does not complete ERP data migrations, source reconciliation, or module APIs. Dashboard numbers and module operations remain unavailable until their separate M02–M10 gates pass.
