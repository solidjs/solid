---
"solid-js": patch
---

Server `createMemo` does less work per run. A memo that returns a plain value (not a promise or async iterable) now skips the owner-id read, the `NoHydrateContext` lookup and the slot-recording closure in `processResult`, and each run saves and restores the owner and observer inline instead of through two nested closures and three exception-handler frames. On TanStack Router's SSR before-load benchmark this cut solid-js self time by about 22% and the request loop by about 4%.
