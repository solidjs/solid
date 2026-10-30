---
"@solidjs/signals": patch
---

A render effect in a branch an action holds (`<Show when={y() > 0}>` opened by the action's write) no longer runs ahead of that branch's landing when it reads `latest(y)` inline, while the same read through a memo waited: a member of the frame a held pass built is the hold's own work, so neither form seats it as the hold's verdict reader, and memo wrapping no longer changes what it shows.
