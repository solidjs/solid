---
"@solidjs/web": patch
---

The bare server-function address no longer decides its answer shape by the
absence of a header (#3139). The no-JS redirect convention (303, outcome
in the flash cookie) engaged on shape alone — form content type, no format
tag — which a page script's `fetch(url, { body: new URLSearchParams(...) })`
also matches: the script followed the 303 to the referrer's HTML, read
`response.ok === true`, and its answer disappeared into a cookie it would
never look at. Dispatch now reads the browser's own word for the caller
kind: `Sec-Fetch-Mode: navigate` (or no fetch metadata, for older
browsers) keeps the convention, while a script's form-shaped post is
refused 400 before dispatch — before the mutation runs — pointing at the
data address and the format tag, the two spellings that work. Tagged
direct-HTTP callers keep the plain response as documented.
