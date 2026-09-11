---
"@solidjs/web": patch
---

Rebuild the buffered server-function request from its url, method, headers and signal instead of through the `Request` copy constructor, so a host adapter's lazy request (Nitro via srvx) no longer fails every POST with 400 "Malformed server function arguments"; only a failed upload read answers 400 now, a failure to put the bytes back surfaces as its own error.
