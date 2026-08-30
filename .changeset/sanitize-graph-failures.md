---
"@solidjs/web": patch
---

Sanitize a failure that escapes through a server function's result graph.
`sanitizeServerError` guarded the one road a thrown error takes out of
dispatch; a rejected promise, an async iterable that throws, or a stream
that errors reaches the codec as a value to encode instead, and shipped
its `message` and every own-property to the client verbatim — a driver
error's failing query, connection string and bound params included —
under a 200 carrying no error tag, because the head was already
committed. Those channels are now wrapped before either serializer sees
them: the response encoder and the frames flight sink, which encodes its
outcome with a serializer of its own.

The walk covers plain objects, arrays, `Map` and `Set`. A channel held by
a class instance or behind an accessor is left alone — rebuilding one and
invoking the other are not the runtime's to do. `markSafeError` remains
the escape hatch, an `Error` that is a returned value is untouched, and
the wire format is unchanged, cycles and shared references included.
