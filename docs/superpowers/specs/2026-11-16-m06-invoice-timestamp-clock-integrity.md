# M06 — Posted invoice timestamp clock integrity

**Background:** PR #351 is merged at `a2b10f33be041adfefde28992689f17067912fdb`. It rejects impossible calendar dates in the trusted D1-compatible invoice read model; its input format still accepts impossible time and numeric timezone values embedded in the same canonical Date field.

**Business risk:** If an imported Sale Date is `2026-11-15T25:61:99` or `2026-11-15T10:20:00+06:90`, the posted-invoice read model returns a plausible printable invoice date while silently discarding a corrupt timestamp. A failed import should be quarantined, not silently accepted as verified history.

**Decision:** Keep the existing format and Gregorian date checks. Validate the optional clock components in `dateOnly`: hour 00–23, minute 00–59, second 00–59, numeric timezone offset hour 00–23 and minute 00–59 (no leap seconds in this canonical export). Preserve time zone strings in both `+HHMM` and `+HH:MM` forms, optional fractional seconds, `Z`, and no-offset timestamps. Do not reinterpret local dates into UTC; existing read model keeps original date text for source parity.

**Safety:** Only the pure, already-authorized posted-invoice read projection changes. No database writes, new Worker binding, legacy GAS, printer UI, Party ledger, sale posting, Cash/Bank records, authentication or multi-unit changes. Original `sale['Time']` uses separate source compatibility and is untouched. No deployment of production POS follows from this change.

**Acceptance:** The original invoice projection must fail closed on impossible timestamp clocks/timezone components, including `24:00:00`, `23:60:00`, `23:59:60`, `+06:90`, `+24:00`. Real leap-day 2024-02-29 at 23:59:59 +06:00, UTC Z, fractions and compact offsets must still print original invoice date and expected due date. All existing source-parity and timezone regressions remain green. GitHub evidence must show failing RED test first and exact-head GREEN CI before review/merge.

**Alternatives considered:** (1) ignore impossible time fields because only date is displayed—rejected, corrupt imported timestamp falsely appears valid; (2) replace all date/time parsers across ERP—rejected as cross-module scope creep; (3) validate only the canonical Date timestamp suffix—selected for KISS and safety.
