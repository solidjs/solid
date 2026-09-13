---
"@solidjs/signals": patch
---

`merge()` no longer flattens through a plain-object merge result. That form is a real object callers may copy (`Reflect.ownKeys` descriptor copies, `{...props}`) or mutate afterwards (`@solidjs/html` assigns props and a `children` getter after spreading), and a later `merge` tunnelled back to the original sources through the `$SOURCES` symbol — resurrecting removed keys and dropping added or overwritten ones (#3384). The plain result now records no sources and is read like any other object; only merge *proxies*, whose writes are no-ops, are still flattened. A side effect: `merge(defaults, props)` where `props` is itself a plain merge result that covers every default now returns `props` directly instead of always allocating.
