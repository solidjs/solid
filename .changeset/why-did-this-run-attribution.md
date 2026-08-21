---
"@solidjs/signals": patch
---

Dev-mode "why did this run" attribution (opt-in via DEV.attribution.enable()): every re-run reports its cause chain down to the originating write, with history/why/costs queries, live subscription, and perf warnings (HOT_SCOPE_RERUNS, HOT_SCOPE_TIME, WIDE_SCOPE_DEPS). The engine installs onto a narrow dev-only hook surface (attribution-hooks.ts) that external devtools can implement instead; disabled cost is one null check per hook site and prod builds fold every site out at byte-parity (async landings report unconditionally and the engine derives committed-ness from its asyncStart snapshot, so no dev flag escapes core's try blocks).
