---
"@solidjs/web": patch
---

Frames client, size audit pass: (1) the seroval codec no longer ships in the eager graph — the per-response data tables materialize lazily through the frame host's new `prepareData` hook (`import("@solidjs/web/serialization")` awaited by the transport before the first `data` chunk delivers), so HTML chunks, scalar slot args and document records (self-executing hydration scripts) stay codec-free; the eager frames consumer drops from ~16.8 to ~10.9 kB gz, with the codec loading on demand only when serialized data actually arrives. A new size scenario pins the eager entry at 10.35 KB with the codec external, so a static seroval import creeping back fails CI. (2) The `sc:live` catch-up log compacts on last-value-wins keys (`type:fid:key`) instead of retaining every op for the life of the page — memory is bounded by distinct targets and a late-adopting boundary replays the latest state in one pass instead of the whole history.
