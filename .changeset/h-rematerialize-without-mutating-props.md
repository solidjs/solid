---
"@solidjs/h": patch
---

`h()` no longer writes to the caller's props object, so an element can be materialized again (a `Show` re-showing children whose own children are `h()` elements threw "Cannot set property children … which has only a getter"). An `h()` element returned from an accessor child is now created in the insert's tracking pass rather than re-created whenever its output changes (an accessor returning `h(Loading, …)` over async children never settled). A function `class` on a tag with static classes (`h("span.a", { class: () => … })`) keeps the static classes. `h(...)` with element/component arguments is typed as `HyperElement`, so `render(h(App), el)` — the documented root form, now corrected in the README — type-checks.
