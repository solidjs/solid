---
"solid-js": patch
---

Hybrid store handoff no longer opens a pending window (#3574). An `ssrSource: "hybrid"` store's client takeover run — the re-run that continues from the adopted server answer — made the store read pending until its duplicate first yield landed, so a streamed `<Loading>` resuming to claim its fragment after the answer landed selected its fallback against resolved server content: a "Hydration key miss" warning and a flash of the fallback over the streamed content. The handoff now lands the adopted answer as a synchronous first step (generator and promise-shaped sources alike); the store reads settled through the handoff, and `isPending` is false for it, until the client source produces something new.
