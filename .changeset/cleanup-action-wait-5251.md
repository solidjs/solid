---
"@solidjs/signals": patch
---

An action started from an effect's cleanup (or an effect callback, or `onSettled`) that writes nothing before it waits no longer holds a later, unrelated action: the later action's writes commit when its own body ends.
