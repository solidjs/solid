---
"@solidjs/signals": patch
---

A render effect created while an action holds a value it reads no longer runs its callback when a later pass re-stages it before the action lands (#3802). That run passed `undefined` as the value, because the effect had nothing committed yet, so compiled JSX bindings threw and halted reactivity. The effect now runs once, at the commit that lands the action, with the latest staged value.
