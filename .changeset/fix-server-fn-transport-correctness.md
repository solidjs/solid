---
"@solidjs/web": patch
---

Three transport-correctness fixes on the server-function HTTP surface. A
POST whose body-format tag names no decoding this runtime has — an unknown
tag, a duplicated format header comma-joined by `Headers`, an untagged
non-form body — is refused 400 before dispatch instead of calling the
function with a substituted `undefined` argument that let the mutation
commit and answer 200 (#3130). The transport's defaulted
`Cache-Control: no-store` is no longer written onto a 304, which is a
cache UPDATE rather than a stored response — the default was instructing
caches to evict the very entry the conditional request had just confirmed
(#3134). And `redirect()` percent-encodes non-ASCII code points in its
target before the value touches the latin1 `Location` header: targets
above U+00FF used to throw (masked as a sanitized 500) and latin1-range
characters rode as raw bytes a client decoded to U+FFFD, redirecting
`/café` to `/caf%EF%BF%BD` (#3135). ASCII passes through untouched, so
already-encoded targets are not double-encoded.
