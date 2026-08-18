---
"solid-js": patch
---

Live sources get automatic SSR policy (auto-hybrid)

A `live()`-declared server function's iterable is branded a standing answer (every yield is the complete current value; the source re-yields current state on any invocation). SSR now detects the brand and applies the right lifecycle without any `ssrSource` declaration:

- **Document face**: takes the first value, closes the iterator, and serializes a plain value — instead of streaming an unbounded source into a response that never closes. The brand selects hybrid under server mode whether defaulted or declared ("server" has no meaning for a standing answer).
- **Client takeover**: the hydration adoption path's existing trace run detects the brand and arms a shared post-hydration gate — the node adopts the serialized t=0 value for the claim walk, then re-runs its compute to reconnect, serving the stale value until the first live yield lands.
- **Stream face**: inside a server-owned frame render the scope-gated commit pump keeps the standing answer connected — the brand does not close it there.

Declared `ssrSource: "hybrid"`/`"client"` behave as before; unbranded iterables keep their bounded-trace semantics on every path.
