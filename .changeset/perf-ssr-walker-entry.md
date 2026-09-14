---
"@solidjs/web": patch
---

SSR: fold the text-separator entry wrappers back into `tryResolveString` and `resolveSSRNode`. #3394 split each walker into an entry function that reset the separator state and a recursive body; the bodies are too large for V8 to inline, so every template hole paid an extra call. The recursion now passes a `nested` flag instead — one function each, same output — recovering the ~2% SSR throughput that split cost on element-heavy pages (up to 7% where holes are dense).
