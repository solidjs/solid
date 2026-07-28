---
"@solidjs/web": patch
---

Adopt @dom-expressions/runtime 0.50.0-next.32, which absorbs the router-agnostic wire protocols from Solid Router. Through the `server-functions` entries this adds: the flash cookie protocol (`FLASH_COOKIE`/`hasFlashCookie`/`clearFlashCookie` on both entries; `encodeFlashCookie`/`decodeFlashCookie` and the `FlashSubmission` shape on the server entry), `foldSetCookies` for replaying a mutation's `Set-Cookie` deltas onto request headers, `REVALIDATE_HEADER` as a named export next to the response helpers that write it, and `createNoJSHandler` — which `handleServerFunctionRequest` now applies to browser form posts by default, so form posts made without the client runtime redirect back with the outcome flashed instead of answering with a serialized payload (configure or disable via `handleNoJS`). Also fixes a thrown bodyless `Response` being nulled before reaching `handleNoJS`, which silently dropped the redirect target.
