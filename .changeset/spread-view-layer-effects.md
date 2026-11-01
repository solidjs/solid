---
"@solidjs/web": patch
---

perf(web): spread reruns skip condition memos and diff a view's values by position

A spread's attribute effect reruns every getter it reads, so a compiled condition memo inside one of those getters (`memo(() => !!cond)()`) was rebuilt on each run. Outside hydration it now resolves inline. A spread over a merge/omit view of plain objects reads its values into an array by position and applies only the changed ones, instead of building a props object and diffing it key by key. It is still one effect per element. On the polymorphic chain bench, update goes from 6.2 to 4.3 ms with mount unchanged.
