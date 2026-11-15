---
"solid-js": patch
---

server: a disposed owner returned to the SSR owner pool drops its `_context`, so a finished render's provided values (and anything they reach) can be collected once its stream ends, even when concurrent renders fill the pool (#4890).
