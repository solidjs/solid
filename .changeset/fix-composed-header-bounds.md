---
"@solidjs/web": patch
---

Bound the composed redirect and revalidate response headers (#3131, the
#3093 class). A 20K-character redirect target or a few hundred
revalidation keys produced a header past receivers' limits — undici's
16 KiB default, nginx's one-page proxy buffer for the whole header block —
so the response died at the socket (HPE_HEADER_OVERFLOW) after the
mutation committed. Truncation is not an option for these values the way
it was for #3093's error label: a trimmed target is a different address
and a trimmed key list is a silently stale cache. So `redirect()` and the
`revalidate` option now refuse past 4096 characters with a legible error
naming the remedy (carry the state server-side; split the invalidation or
use coarser keys). The bound sits in the producing helpers, which run
inside the function body, so both the returned and thrown spellings land
on the ordinary error path — what leaves dispatch is the error shape,
attributable and parseable. A raw `Response` built by hand with an
oversized `Location` remains the author's own; only the helpers are
bounded.
