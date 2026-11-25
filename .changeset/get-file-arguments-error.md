---
"@solidjs/web": patch
---

A `GET` server function called with a file among its arguments (with `enableRichArguments`) now throws a clear error before sending, instead of putting `[object FormData]` in the url and failing with a 400. A `GET` call whose codec-encoded arguments are too long for a url and go over POST now sends the encoding it already made instead of encoding the arguments a second time, so a one-shot argument such as an async iterator arrives with all its chunks.
