---
"@solidjs/web": patch
---

Fail `renderToStream` when an asynchronous value cannot be serialized after its key was handed to the default serializer, if that happens before the first flush (an awaited render, or before the shell went out). The render tears down without calling `onCompleteAll` and nothing is sent (#4647). Synchronous serialization failures and custom serializers keep their existing behavior.
