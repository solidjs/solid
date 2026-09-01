---
"@solidjs/web": patch
---

Forward an author's 3xx status consistently (#3096). The scripted redirect mask now covers exactly the statuses fetch follows (301, 302, 303, 307, 308) — a 304, the natural answer for a conditional read, forwards untouched for every caller. Returned envelopes keep their status for unscripted callers (the returned path used to hardcode 200 where the thrown path forwarded it), and the no-JS form convention honors a returned redirect envelope's Location the way it already honored a thrown one.
