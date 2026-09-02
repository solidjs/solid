---
"@solidjs/signals": patch
---

Region audit round 2: change-gated version bumps (no-op reconciles and value-equal rewrites never park writes under transitions — region presence keeps classic timing); durable admission (accessor acquisition via defineProperty or getter-bearing adoption demotes bound regions through their onDemote hooks, with the plainness probe running before any value scan); helper safety parity (regionBind shares createRegion's declines, with a trusted flag for compiler-proven callers; deliveryEffect/createRegion swallow commit returns); disposeChildren exported for generation-owner row teardown (bulk one-walk disposal, closing the ownerless-nested-region blocker).
