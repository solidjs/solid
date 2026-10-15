---
"@solidjs/web": patch
---

Direct server-function calls no longer report thrown `Response` or `ResponseEnvelope` values as `server-function/thrown` failures, matching HTTP dispatch. Callers still receive the response or the envelope's value. A response that reaches a boundary or the render root is still reported by the renderer.
