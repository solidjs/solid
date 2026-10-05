---
"@solidjs/web": patch
---

Server functions: arguments never decode `Response` or `Request` values. The handler decodes client → server argument payloads with the configured plugin list minus the `Response`/`Request` plugins, so a call carrying one — top level, nested, or inside a promise or stream — is refused with `400` before the function runs. `enableRichArguments()` rejects such a call before sending. Results and hydration keep the full plugin set.

Server-function responses now default to `X-Content-Type-Options: nosniff`; a value the function sets itself is kept.
