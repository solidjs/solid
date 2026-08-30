---
"@solidjs/web": patch
---

Sanitize a failure that escapes through a server function's result graph. `sanitizeServerError` guarded the one road a thrown error takes out of dispatch; a rejected promise, an async iterable that throws, or a stream that errors reaches the codec as a value to encode instead, and shipped its `message` and every own-property to the client verbatim — a driver error's failing query, connection string and bound params included — under a 200 carrying no error tag, because the head was already committed. Those three channels are now wrapped before the codec sees them, on the plain response path and in the frames flight sink, which encodes its outcome with a serializer of its own, so a failure arriving through one is sanitized like any other. `markSafeError` remains the escape hatch, an `Error` that is a returned value is untouched, and the wire format is unchanged.
