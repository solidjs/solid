---
"@solidjs/web": patch
---

Label the unknown-id 404 so version skew is recoverable (#3110). A call whose well-formed address is not registered in the answering deployment — a tab holding the previous build's ids across a deploy, or a genuinely removed function — now answers with an `X-Server-Function-Unknown` header, and the client stamps `unknownFunction: true` (plus a directed message) on the rejection. Integrations can act on it — typically by reloading the document onto the current build — instead of surfacing a generic failed call. A 404 for a path the address scheme gives no meaning to stays unlabelled.
