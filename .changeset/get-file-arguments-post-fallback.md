---
"@solidjs/web": patch
---

A `GET` server function whose arguments cannot go in the url sends them over POST, still as a read: with the codec, a file among the arguments (or a long codec string) sends the codec's encoding once instead of putting `[object FormData]` in the url or encoding the arguments a second time; without the codec, a File, Blob, FormData or URLSearchParams argument goes as its natural body, as the default POST transport sends it, instead of throwing.
