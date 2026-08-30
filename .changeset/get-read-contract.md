---
"@solidjs/web": minor
---

Name the contract a `GET()` declaration signs, and add the opt-out of its trade (#3114). The origin gate is skipped for GET-declared reads by design — same-origin policy already keeps a cross-site caller from reading the response, and the gate's `Vary` fragments the shared-cache entries the helper exists to enable — which makes declaring GET a safety assertion, not only a transport choice: the function becomes executable from any origin, with caller-chosen arguments, carrying the user's ambient cookies. That contract is now stated on `GET()`'s documentation on both entries (declare GET only for reads that are safe in the RFC 9110 §9.2.1 sense), and `csrf: { protectDeclaredReads: true }` lets a deployment that does not rely on shared caches apply the origin gate to its reads as well. Both halves are pinned by tests: the default skip, and the opt-in gate.
