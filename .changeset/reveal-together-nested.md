---
"solid-js": patch
---

Fix nested `<Reveal>` coordination: a nested group is now held on its fallbacks
until its parent releases the slot it occupies, in both the client runtime and
SSR streaming. Previously, an inner `Reveal` inside an outer `order="together"`
(or past the frontier of an outer `sequential` without `collapsed`) could reveal
its own children independently, breaking the outer group's "reveal as one unit"
guarantee.

Key behavior changes:

- `order="together"` now releases when every direct slot is "minimally ready"
  under its own order (a nested `sequential` is minimally ready at frontier-0,
  a nested `natural` when any child is ready, a nested `together` when all its
  children are ready) rather than waiting for every descendant to fully resolve.
  This keeps `together` composable without sacrificing the cohesive group reveal.
- When an outer `sequential` advances to a nested `Reveal` as its frontier, or
  an outer `natural` surfaces a nested `Reveal` slot, the nested group is now
  released to run its own order locally. Previously the nested group inherited
  the outer's hold, which forced its children to reveal together once released;
  they now reveal per the nested group's own policy (e.g., inner `natural`
  children reveal independently as their data lands). This applies to both the
  client runtime and SSR streaming.
- SSR fix: when an outer `sequential+collapsed` frontier advances to a nested
  `Reveal`, the inner group now emits `revealFallbacks` for its leaf children so
  their collapsed fallback templates become visible under the inner's own order.
  Previously the inner fallbacks remained hidden until they resolved. Requires a
  matching `dom-expressions` update: `$dflj(ids)` now materializes every id in
  the list instead of stopping at the first, so bulk uncollapse reveals all of
  its listed fallbacks in one call. Solid's `advanceFrontier` now passes the
  single new frontier key to `revealFallbacks` for sequential cascading, which
  preserves the prior incremental behavior.
- Nested `<Reveal>` groups cannot opt out of an outer group's hold while it is
  still held. Wrapping a subtree in a `<Loading>` does not bypass this — the
  `<Loading>` is itself a slot the parent holds. Subtrees that need independent
  reveal should not be nested under an outer ordering.
- On the server, HTML for resolved fragments still streams immediately into
  templates; only the `revealFragments` swap calls are stashed and drained in
  resolution order when the enclosing `Reveal` releases the slot.

See `documentation/solid-2.0/03-control-flow.md` for the updated nesting matrix
and the "minimally ready" definition per order.
