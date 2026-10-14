---
"@solidjs/web": patch
---

Fix aborting a document that renders a live server component crashing Node: the document's `sc:live` channel now marks itself closed when the abort cancels it, so the render's own end (and any late hole op) no longer closes or writes the cancelled stream, which escaped as an unhandled `ERR_INVALID_STATE` rejection.
