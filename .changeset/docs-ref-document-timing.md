---
"solid-js": patch
---

The DOM docs and cheatsheet narrow the ref-timing note: inside a ref, `el.ownerDocument.defaultView` is `null` only when the element's template contains no custom element; a template with one is imported into the live document as a whole.
