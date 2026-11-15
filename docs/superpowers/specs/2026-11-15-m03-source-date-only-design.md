# M03 — GAS-free source-compatible date-only normalization

**Pinned original:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (frozen `legacy/source/Utils.gs` functions `safeDateOnly_` and `formatDate_`).
**Workstream:** M03 Utils/async portability; independent from pending PR #168 time-only normalization and existing M04 staff/M06 sales phone helpers.

## Source behavior

Original `safeDateOnly_(value)` immediately returns empty string for a falsy input. Otherwise it calls `formatDate_(value)`, which constructs `new Date(value)` and formats `yyyy-MM-dd` using `Session.getScriptTimeZone()` and `Utilities.formatDate`. When parsing or formatting throws, the original returns the first ten characters of `String(value)`. Therefore midnight UTC and ISO timestamps may produce different **local dates** across IANA zones. A blanket `value.slice(0,10)` or implicit UTC conversion is not source compatible.

## Minimal reviewed design

New internal-only `src/modules/source-date-only.js` exports `safeSourceDateOnly(value,timeZone)`.

- Falsy input returns `''` exactly, even with no timezone.
- For all non-falsy values, require an explicit, trusted, nonempty **IANA timezone** rather than guessing Worker UTC; reject invalid timezone with a TypeError/RangeError. This is the intentional hardened boundary compared with implicit GAS Session.
- Use native `new Date(value)` and `Intl.DateTimeFormat` with `timeZone`, `year:'numeric'`, `month:'2-digit'`, `day:'2-digit'` and `formatToParts`. Reassemble `yyyy-MM-dd` without locale display punctuation. This follows source **date parsing plus business-zone** semantics; no user-supplied timezone should be accepted by a future public RPC.
- If the date value cannot be parsed/formatted, follow the original `catch` fallback `String(value).slice(0,10)`. Do not silently return today's date. No external library or mutable cache.
- Does not duplicate `safeTimeOnly_`, Settings boolean, staff-phone or M06 phone helper. This PR creates the primitive only; no existing caller, UI handler or RPC is switched over yet.

## Acceptance and safety

Tests execute the frozen original `safeDateOnly_` and `formatDate_` in a Node VM with test-only GAS Session/Utilities adapters, compare with fixed expected literals and port outputs for UTC and Asia/Dhaka/New York midnight boundary, Date objects, ISO timestamps, invalid/text fallback, coercion, and falsy inputs. Invalid/missing timezone fails closed. Test-first RED expected import missing, then GREEN complete Node + existing real local Workerd/D1 CI. No prod D1, SQL/migrations, `src/db`, `src/rpc`, `src/index.js`, original GAS/HTML/CSS, Cloudflare configs or Party identifiers touched. Future integration still requires reviewed trusted timezone and M04 session authorization.
