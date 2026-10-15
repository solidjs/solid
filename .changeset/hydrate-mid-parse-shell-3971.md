---
"@solidjs/web": patch
---

fix(web): `hydrate()` started mid-parse waits for the end of the shell (#3971)

An `async` client entry can run while the browser is still parsing the server shell. `hydrate()` then gathered only the `_hk` nodes parsed so far, created fresh client nodes for the rest, and left the server copies parsed afterwards in the document, dead (no listeners, no bindings).

A render that emits `<HydrationScript />` now ends its shell with a small marker script, after its records, and its bootstrap declares the ledger the marker writes to. When `hydrate()` starts before that marker has run and the parser is still working, it parks until the marker runs (or `DOMContentLoaded`, if none comes), then hydrates against the complete shell. Streamed fragments arrive after the shell and are claimed as before, so streaming still hydrates before the stream ends. No API change. A host-placed bootstrap (`generateHydrationScript()`: hand-built documents, islands hosts such as Astro that await each island's children themselves) declares no ledger and never parks; renders without `<HydrationScript />` and `noScripts` renders are byte-identical.
