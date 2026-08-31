---
"@solidjs/web": patch
---

Answer the labelled version-skew 404 before the CSRF origin gate (#3136).
A removed id is no longer in METHODS, so it could not be recognised as a
declared read and the gate fired on it: every caller without origin proof
— a CDN revalidating a GET-declared read, an uptime monitor, a
server-to-server client (Node's fetch sends none of the headers the gate
reads) — got a bare 403 instead of the `X-Server-Function-Unknown` 404,
so a deploy that removed a function read as an auth/WAF failure in the
edge logs and the #3110 recovery signal was invisible. Nothing is
registered at an unknown id, so the gate had nothing there to protect,
and the ids were never secret — the compiler ships them in the client
bundle. The hoisted lookup is a side-effect-free Map read, the labelled
404 no longer carries the CSRF `Vary` (its answer does not depend on
origin proof, so it must not fragment shared-cache entries on it), and
the meaningless-path 404 stays bare and stays gated. Diagnosed, measured,
and drafted by @frenzzy.
