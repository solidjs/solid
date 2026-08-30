---
"@solidjs/web": patch
---

Sanitize a failure that escapes through a server function's result graph. `sanitizeServerError` guarded the one road a thrown error takes out of dispatch; a rejected promise, an async iterable that throws, or a stream that errors reaches the codec as a value to encode instead, and shipped its `message` and every own-property to the client verbatim — an ORM error's failing query, connection string and bound params included — under a 200 carrying no error tag, because the head was already committed. The same sanitization now applies on that road, claimed as a codec plugin so it covers every channel without walking the result. `markSafeError` remains the escape hatch, and the replacement is branded with it so the wire shape stays a plain `Error` node.
