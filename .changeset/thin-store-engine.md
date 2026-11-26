---
"@solidjs/signals": patch
---

Stores run on one signal per key a reader touches (the "thin" engine), in place of the deep engine's per-target committed backing and overlay. The public store API is unchanged, with one correctness fix: a store write now becomes visible at the flush that carries it for every reader, the same as a signal write. The deep engine let some reads between a setter and its flush see the new value early; those reads now return the old value until `flush()`. An app with stores ships about 2 to 3.3 KB less brotli, and an app without stores ships no store code at all. A push to a list no reader has read yet is now kept for a boundary that resumes after it, so the resume claims the server's rows and catches up (GH3).
