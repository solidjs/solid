---
"@solidjs/signals": patch
---

Fix an infinite flush loop ("Potential Infinite Loop Detected") when a `latest()`-gated `Show` mounts a fresh `Loading` under an action hold: lane work that reads a node born staged is no longer re-queued to re-derive on a committed value it doesn't have.
