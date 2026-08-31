---
"@solidjs/web": patch
---

Amortize ChunkReader buffer growth: the framed-stream reader reallocated and copied everything received so far on every network read, making one frame O(reads²) — ~200× the CPU for a payload delivered at slow-client read sizes, on both the server (argument decode) and client (response decode) legs. Growth now appends in place, compacts drained frames, and reallocates at ≥2× only when outgrown (#3154)
