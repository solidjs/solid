---
"@solidjs/signals": patch
---

The store setter's owned-scope write guard no longer exempts roots (#3500). A `createRoot` body is tree construction — every dev component body, every context Provider, the top of `render()`, and the whole SSR pass run directly under one — so a store write there is a write in an owned scope, exactly as `setSignal` has always treated it. Dev/test builds now throw `REACTIVE_WRITE_IN_OWNED_SCOPE` for store writes in root and component bodies that previously passed silently; production is unaffected (the guard is dev-only).

`OBSERVE.exclude`: the `IMMUTABLE_UPDATE_IN_STORE` census now names the store's own owner as its subject rather than the writer's context, so an excluded panel's store stays silent however its writes arrive. The docs no longer suggest `runWithOwner(panelRoot, …)` for panel writes — that is a write in an owned scope.
