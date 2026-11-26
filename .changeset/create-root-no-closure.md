---
"@solidjs/signals": patch
---

`createRoot` calls `init` without allocating a wrapper closure for each root. Creating a root is 10 to 25% faster in a Node microbench; `init` still receives `dispose` as its only argument.
