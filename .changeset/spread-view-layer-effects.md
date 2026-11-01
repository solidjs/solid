---
"@solidjs/web": patch
---

perf(web): condition memos in a spread's getters resolve inline

A spread's attribute effect reruns every getter it reads, so a compiled condition memo inside one of those getters (`memo(() => !!cond)()`) was rebuilt on each run. Outside hydration it now resolves inline, and the condition's inputs become dependencies of the attribute effect. On the polymorphic chain bench, update goes from 6.2 to 5.2 ms with mount unchanged.
