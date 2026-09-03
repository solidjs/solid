---
"@solidjs/web": patch
---

Bind `GET()` grants to the function identity they were declared about (#3237). The grant — GET/HEAD dispatch plus the CSRF origin-gate exemption — was keyed by id alone, so `register -> register -> GET(oldReference)` handed the NEW function cross-site GET execution on the strength of a declaration the old one signed. The grant now records the declared function, and a single `declaresRead(id)` check governs both dispatch and the 405 `Allow` advertisement; a stale or unverifiable declaration fails closed (GET refused, POST + origin gate required). A declaration or `withMeta({ method })` write that would change an existing grant's binding throws in dev and fails closed in prod, never silently rebinds.
