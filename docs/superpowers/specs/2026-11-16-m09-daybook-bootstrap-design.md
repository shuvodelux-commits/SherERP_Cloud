# M09 Day Book bootstrap source parity — design

Date: 2026-11-16. Source authority: frozen Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2, legacy/source/DayBook.gs::getDayBookBootstrap and legacy/source/daybook.html.

## Goal
Preserve the initial Day Book presentation contract without prematurely enabling financial reads or administrative actions. The original UI calls serverCall('getDayBookBootstrap', authToken) and needs exactly currencySymbol, editableDays, modules and isAdmin. The original getter requires daybook:view and derives the Administrator flag from an authenticated user's Role. In this first slice the caller supplies a previously authorized, trusted user and trusted Settings map; the pure projection does not authenticate or grant permissions.

## Approaches
1. Full Day Book RPC and financial read model now: rejected because M05/M07/M08 D1 posting data and public M04 RPC remain incomplete.
2. Internal source-shaped pure bootstrap only: chosen. Add a small test-first projection and original-GAS oracle. No public route, D1 binding, shared auth changes or UI redesign.
3. Stub a success response in the Worker shell: rejected because it would falsely signal a working Day Book.

## Contract
Export projectDayBookBootstrap(settingsMap, actor) returning the source's four fields in source property order. Preserve the 12 exact DAY_BOOK_MODULES labels and ordering, the Currency Symbol fallback to empty string, source Number(value) || 0 editableDays semantics for normal trusted scalars, and a strict role-name equality with 'Administrator'. Return a fresh modules array each call. Reject untrusted object shapes, getters, Promise values, nonfinite values or absent/untrusted actors before accessing data. No user-controlled role or settings lookup is made here; the caller must authenticate and enforce daybook:view in a real authorized D1/RPC layer.

## Invariants / gates
Original GAS, HTML, payment/ledger data and other M09 projections remain unchanged. A browser must not receive this projection until a real M04 daybook:view authorization gate with session revocation and role-version checks is tested against isolated Workerd/D1; transactions also require their own separate read-model reconciliation. No Party netting or edit/delete action is enabled. Undo by reverting these independent files; zero data migration or Cloudflare binding impact.
