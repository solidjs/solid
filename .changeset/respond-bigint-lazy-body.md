---
"@solidjs/web": patch
---

`respond(value, init)` accepts every value a plain return does (#4060). Its passthrough JSON body — read only by consumers without the client runtime — is now encoded when read instead of when the envelope is built, so a `bigint` no longer throws inside `respond()` and fails both the direct call and the HTTP call. Unscripted HTTP callers get the carried JSON body only when JSON carries the value faithfully; otherwise the value is encoded the same way as a plain return.
