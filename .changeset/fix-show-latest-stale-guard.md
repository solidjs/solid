---
"solid-js": patch
---

Non-keyed Show judges staleness from the truthiness that selected the child, so a first mount of when={latest(x)} renders and a live update does not look stale
