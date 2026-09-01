---
"@solidjs/web": patch
---

Carry masked redirects in a dedicated header and retire the RC transition shims. Scripted callers now receive redirects as `X-Server-Function-Redirect: <status> <url>` with the target resolved server-side against the request URL (#3102) — `Location` never rides a masked 200, so an authored `Location` on a forwarding status (a 201's created-at) stays data, and integrations compare origins on a real URL instead of guessing navigation strategy from the author's spelling (#3107). `decodeRedirectHeaderValue` is exported for readers. Removed the transitional instance-header scripted fallback at the bare address and its forced no-store (#3094): the answer shape is now a function of the URL alone, with the data address as the only scripted path.
