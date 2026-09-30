---
"@solidjs/web": patch
---

Fix the document live channel (`sc:live`) crossing as an async iterator instead of a ReadableStream. The hydration serializer's channel guard (#3468) treated every async iterable as a source to wrap, and Node's `ReadableStream` is one — so the frame sink's hole/attr op channel reached the client in a shape its pump (`getReader`) never reads, and a server component streaming into the initial document froze at its first value (the chat welcome stopped after its first paragraph). A `ReadableStream` now keeps its type through the guard: a stream over the source's chunks whose failure crosses sanitized, like a rejection.
