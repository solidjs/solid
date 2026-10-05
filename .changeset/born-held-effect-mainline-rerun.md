---
"@solidjs/signals": patch
---

A render effect born held inside a mount (a memo in the mount read a value an action holds, so the mount waits for the action) no longer runs with no value when an unrelated mainline write reaches it before the action settles. It re-stages, and its first run is the commit's (#3802).
