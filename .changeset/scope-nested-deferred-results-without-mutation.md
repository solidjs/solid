---
"@solidjs/web": patch
---

Scope deferred work nested inside plain-object and array carriers to the producing call's request event (#3241, completing #3222). The HTTP road already applied the wrapping in the encoded representation (the guard walk's rebuilt shells); the direct SSR road only looked at the returned value itself, so `return { rows: cursor() }` ran its generator under the render's ambient event — two concurrent direct calls read and wrote each other's `locals`, and the render's own. The direct road now descends plain-object/array carriers and hands the caller a shallow-rebuilt carrier with the bound wrappers in the deferred slots; the user's returned containers are never written into, and results with nothing deferred keep their identity. Set/Map members, class instances, and frozen/non-writable slots are deliberately out of the carrier set (pinned by test): bodies reached through them stay bound to nothing, as before.
