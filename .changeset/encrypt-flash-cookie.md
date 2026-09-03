---
"@solidjs/web": patch
---

Encrypt the no-JS flash cookie (#3239). The flash carries the submitted form input — whatever the user typed — so its payload is now AES-GCM encrypted under a key derived (domain-separated) from the deployment secret: `configureServerFunctionsServer({ secret })`, falling back to the `globalThis.__SOLID_SECRET__` value the Solid bundler plugin injects into server builds. With no secret configured the outcome is withheld rather than sent in the clear (the post still redirects; dev builds warn once). Decryption failure — a tampered cookie, a rotated secret — reads as "no flash". The cookie now also carries `SameSite=Lax` and `Max-Age=60`, and `encodeFlashCookie`/`decodeFlashCookie` are async.
