---
"@solidjs/compiler": patch
---

Refresh pass: modules rendering document-shell elements (`<html>`/`<head>`/`<body>`) now take the `@refresh reload` path (decline + full reload) instead of registering hot-swappable components (#3151). A document shell can never hot-swap: the hydratable compile emits no client template for those elements — they are only recoverable from the hydration walk, so a post-hydration re-render throws a hydration mismatch — and their static markup/attributes exist only in the server-rendered HTML, so even a successful swap could not reflect the edit. Editing a Document/Shell component now triggers a full page reload that fetches a fresh server render.
