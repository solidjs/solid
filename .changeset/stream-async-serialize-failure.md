---
"@solidjs/web": patch
---

Fail `renderToStream` when an asynchronous value cannot be serialized after its key was handed to the default serializer. The render tears down without calling `onCompleteAll`; a piped response ends with the HTML already sent. Synchronous serialization failures and custom serializers keep their existing behavior.
