---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

`serverComponents` (SSR): keep attribute-slot positions bindable on intrinsic elements. A dynamic `class` or `style` now compiles to a whole-attribute `_$ssrElementAttribute` hole instead of a value inside the template's quotes, so a server component's `class={{ selected: filters.all }}` can mark the class name a client attribute slot owns; `ref`/`on*` positions compile, as before, to one guarded `_$ssrClaim` hole per element, which now emits `_s:on:*`/`_s:ref` markers for slot reads (the `_bnd` behavior-claim marker is gone). Both compilers share the `attributeSlots` server-components fixture; plain SSR output is unchanged.
