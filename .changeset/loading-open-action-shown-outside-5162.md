---
"@solidjs/signals": patch
---

A `<Loading>` on its first load no longer reveals content for a write an open `action` still holds while a render effect outside the boundary shows the value from before that write. The content now appears with the action's commit, together with the outside reader (#5162). When nothing outside the boundary shows the write, the content still reveals as soon as its answer lands.
