---
"solid-js": patch
---

Dev tooling 2.0 surface: remove registerGraph/sourceMap, consolidate devComponent metadata into single _component object, wire DEV.hooks to @solidjs/signals hook registration (onOwner, onGraph, onUpdate, onStoreNodeUpdate), expose graph traversal helpers (getChildren, getSignals, getParent, getSources, getObservers) through DEV, export isDisposed
