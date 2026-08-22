---
"@solidjs/signals": patch
---

Add the `WIDE_WRITE` dev attribution warning: a committed root invalidation
(signal or store write, `refresh()`, async landing) reaching a node with at
least 250 live subscribers (default) warns that every one re-runs this flush,
and points at `createSelector`/`createProjection` for inverting keyed
questions. Reads the dev-maintained subscriber count from the graph-size
diagnostics — no new core sites — and is specced together with the always-on
`HUGE_FAN_OUT` (link-time, 2000+) so the two never double-fire: once per node,
re-warning only after the subscriber count doubles. Documented in the
dev-diagnostics RFC. Configure or disable via
`DEV.attribution.enable({ wideWrites })`.
