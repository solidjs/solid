---
"@solidjs/web": patch
---

A string `class` value no longer stores a property on the element when it is rendered on the client. `className()` cleared its applied-classes snapshot with `node._$classes = undefined` before every string write, which added an own property to each element the first time its class was set, even though only an object `class` value ever fills that snapshot. It now clears the snapshot only when one exists. Mounting 1,000 table rows with six string class bindings each allocates about 118 KB less (1,793 KB to 1,675 KB), and a uibench tree render is 5 to 10% faster. Behavior is unchanged. The hydrating path still seeds the snapshot as before.
