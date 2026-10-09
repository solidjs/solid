---
"@solidjs/web": patch
---

A server component that throws during its synchronous render is no longer cacheable. `respond(View, { headers })` puts those headers on the frame response, and the response is a 200 whose body carries the error, so an author's `cache-control: public, max-age` stored the failure. The render marks the response when it fails, and the transport finalizer declines to store it (`no-store`) and strips the mark, so the mark never leaves. The status stays 200 and the body still carries the error record. A render that succeeds keeps the author's headers, and so does a returned `{ error }` value — the author chose that value and the headers that travel with it. A failure that lands after a suspended shell has already left can no longer change the head.
