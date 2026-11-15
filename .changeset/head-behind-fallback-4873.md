---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
---

fix(web): `useHead` tags of content behind a boundary's fallback are withdrawn while the fallback shows (an `<Errored>` keeps its content alive for `reset()`, so the error page kept the failed page's title) and come back when the content reveals (#4873)
