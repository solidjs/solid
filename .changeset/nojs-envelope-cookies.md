---
"@solidjs/web": patch
---

A no-JS form post answered by `respond(value, { headers })`, returned or thrown, now keeps the envelope's `Set-Cookie` headers on the redirect.
