---
"@solidjs/signals": patch
---

Observe tier: no post-construction fields on reactive nodes.

The observe build stamped `_name` on every node, `_owner` on `createSignal`
nodes and live `_subCount`/`_depCount` edge counters on linked nodes after the
node literal — exactly the hidden-class transitions the prod literals are
shaped to avoid. Measured against prod on the reactivity benchmark the tier
cost +15% overall with creation tests 2–3× under polymorphic load.

- Node factories (`computed`, `createEffectNode`, `signal`, `slotSignal`,
  `createOwner`) now have two literals selected at build time: prod, and
  observe = prod plus its `_name` slot (`_owner` too on signals). Default
  labels (`signal`, `computed`, `effect`, `trackedEffect`) come from the
  literal, so the `createEffect`/`createRenderEffect`/`createTrackedEffect`
  wrappers no longer spread a fresh options object per effect to inject one.
  A dist test pins observe's key set to prod's plus the slots.
- Edge counters are gone. `HUGE_FAN_OUT` is counted by the notify walk a
  committed change already makes over its subscribers, `HUGE_FAN_IN` by the
  recompute pass over the sources it tracks (one module counter in `link()`).
  Both therefore fire on the work — the change / the recompute — rather than
  on the link, once per node and again after +500 growth (a WeakMap, not a
  node field). `WIDE_WRITE` (engine) counts the subscriber list on the write
  and hands over to `HUGE_FAN_OUT` at 2000, so a change never carries both.
  Messages: "changed with N subscribers" / "tracked N sources".
- Prod artifacts are unchanged apart from removing a leftover
  `...(false ? {...} : options)` spread in `createEffect`.
