---
"@solidjs/web": patch
---

Async-mode renders (`await renderToStream(...)`) now produce the same bytes for the same data, whatever order the async sources settle in (#4028). Once the thenable is taken, hydration writes and the pending-promise stub batch are held until the serializer flush and handed to seroval sorted by hydration key, so reference ids and resolution chunks no longer follow settle order. A body-digest ETag now matches across renders whose only difference was API latency. Streaming consumers (`pipe` / `pipeTo` / `readable`) and custom serializers/sinks are unchanged.
