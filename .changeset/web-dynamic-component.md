---
"@solidjs/web": patch
---

Add `dynamicComponent`, the component-only sibling of `dynamic` (client and server entries). Same contract, semantics and hydration shape as `dynamic` — the two share one implementation — but its source type excludes tag names, and it never references the element runtime: `dynamic` must be able to render a tag, so one `dynamic` on a page retains `createElement`, `spread`, the prop-collection helpers and the SVG/MathML tables for everyone; `dynamicComponent` never does. It is the documented way to mount a server component (`dynamicComponent(() => getStory(id))`); a server-component page mounted through it sheds ≈ 2.2 KB brotli. `dynamic` is unchanged.
