---
"solid-js": patch
---

Hydrating a settled promise of an async iterable whose stream already yielded more than once now claims the first value, as a direct stream does, instead of a later one. A stream, direct or behind a settled promise, that threw after its first yield now claims that first value and then shows the `<Errored>` fallback, instead of failing inside the claim pass and leaving the server's content on screen.
