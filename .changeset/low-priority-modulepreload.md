---
"@solidjs/web": patch
---

Server-rendered `<link rel="modulepreload">` hints now carry `fetchpriority="low"`, both in the head and when streamed after the shell, so the module graph yields bandwidth to the entry script that hydration needs first. The entry script keeps its default priority, and client-side navigation hints are unchanged. In an rc.15 app (Tailwind, nine preloaded chunks) patched the same way, Chrome under Lighthouse's devtools throttling hydrated about 350 ms sooner with an unchanged first paint, and Lighthouse's simulated FCP, which counts high-priority scripts as render-blocking, dropped from 1.81 s to 0.91 s.
