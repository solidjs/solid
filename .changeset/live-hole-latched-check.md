---
"@solidjs/web": patch
"solid-js": patch
"@solidjs/signals": patch
---

New dev check `SSR_LIVE_HOLE_LATCHED` (#4023): a live markup hole that shipped its markers and then stopped updating, because re-running it would create reactive scopes (most often a compiler condition memo for `{m.usage && …}`), is now named on the console with the start of its expression, instead of going quiet. Behavior is unchanged; hoisting the property into a local keeps the hole live.
