---
"@solidjs/web": patch
---

Server-rendered `<link rel="modulepreload">` hints for modules outside the entry's static import closure (lazy and route chunks, and modules registered later through `registerAsset("module")`, streamed hints included) now carry `fetchpriority="low"`, so they yield bandwidth to the modules hydration waits on. The entry's static imports and modulepreload links written through the head API keep their default priority. `renderToString` and `renderToStream` take `lowPriorityPreloads: false` to turn the hint off. In an rc.15 app (Tailwind, five entry imports, four route chunks) patched the same way, Chrome under Lighthouse's devtools throttling hydrated about 310 ms sooner with an unchanged first paint.
