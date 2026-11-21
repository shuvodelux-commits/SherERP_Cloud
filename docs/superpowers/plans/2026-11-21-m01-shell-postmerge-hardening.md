# M01 — post-merge Shell modal accessibility and auth fail-closed hardening

Base: `9670c5e2` (PR #860 merged). Isolated M01 branch `m01/shell-postmerge-hardening-20261121`.

Reference: `hisabiq_ui@e42a00a` Application Shell/Sidebar, `docs/design-system/HISABIQ_SHERERP.md`, AGENTS.md UI rules. The original SherERP compiled HTML, `goToPage`, permissions, auth, data adapters, POS and Worker/D1 are authoritative.

## Ruling / ownership
Only `src/ui/hisabiq-shell.js`, its M01-owned Playwright test, and this M01 plan/evidence. No parallel Party/Product/POS/finance/backend edits. The compiled-only layered shell is already shipped, so this is a *small accessibility correction*, not a redesign.

## Tests before code (RED)
1. On 320/390/768px, the open `role=dialog` drawer must make `#app` inert and trap focus; closing by Escape restores prior inert state and focus, including repeated opens.
2. On auth revocation while the drawer is open (app hidden / login cover visible), drawer must close fail-closed and never keep permission-filtered routes exposed. No extra API operation.
3. User `role=menu` starts with a focused visible menuitem, supports ArrowUp/ArrowDown/Home/End, Escape returns to the trigger; existing original sign-out path stays unchanged.
4. Resize from 768 to 1024 must close the modal and clear inert, then allow desktop navigation.
5. Preserve no mobile overflow, selected group state, keyboard Ctrl+B/K, 56px header, 256/64px rail, restricted module filtering.

## Verification and visual rules
Run failing Playwright first; implement minimal fixes; rerun focused suite then build frontend and Owner and M01 regression. Capture before/after actual Chromium screenshots at 320,390,768,1024,1440 with attention to drawer focus, keyboard and overflow; visually inspect. Source `/ui-refine-skill` command remains unavailable on device/installed catalog; use design-system-locked visual inspection and Playwright screenshots without claiming the named skill ran. Attach log summary and CI evidence to PR, keep merge separate from deployment.

## UI evidence and findings — 21 Nov 2026

| Issue | RED evidence | GREEN result | Scope |
| --- | --- | --- | --- |
| Modal background stayed interactive | 320px `#app.inert=false` with drawer open | ERP becomes inert, focus traps, restores after Escape | Compiled shell JS only |
| Login transition exposed stale drawer | Drawer still visible after app hidden, timed out after 1600ms | App/login state observer closes drawer, no hidden-route exposure | No API/auth changes |
| User menu lacked keyboard focus | Trigger remained active after opening menu | First enabled item focused; arrows/Home/End/Escape | Existing original sign-out action preserved |
| 1024px dashboard title ellipsized | Topbar text width: scroll 85px/client 79px | Responsive padding/gap adjustment, search remains present | CSS only |
| 320px bilingual business footer overflow | Drawer width: scroll 452px/client 274px | Break long mixed-script name safely, retain original label | CSS only |

Viewports: 320, 390 and 768px modal; 1024 desktop split; 1440 expanded/collapsed. Screenshots captured by `qa/m01-hisabiq-shell-browser.spec.mjs` under `test-results/hisabiq-shell`; GitHub M01 workflow retains screenshot artifacts. Baseline screenshots were captured from merged `9670c5e2` before edits and inspected; after visual inspection focused on no shifted navigation, reduced motion, focus ring, footer wrapping and no overflow.

The explicit `/ui-refine-skill` executable is unavailable on the connected device / installed skill registry; the design-source-locked screenshot inspection + Playwright analysis is used instead. **Do not claim the named skill ran.** Not a backend rollout or permission to remove legacy UI. Reference dark-theme parity for the wider original ERP remains out of scope; avoid selectively recoloring only the shell.
