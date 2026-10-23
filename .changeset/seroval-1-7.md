---
"solid-js": patch
"@solidjs/web": patch
---

Bump `seroval` and `seroval-plugins` to 1.7.0 (faster serialization: about 20–35% on hydration and JSON writes). A serialized write now ends at its first failing value, so later siblings in the same write are no longer sent after one fails; the keyed serializer settles that write instead of waiting for a `done` that seroval no longer sends. The JSON decoder's end-of-body open-stream count handles 1.7's single-consumer streams (from `ReadableStream` values).
