---
"@solidjs/web": patch
---

Three server-function transport guards: the CSRF origin matcher's verdict is now checked strictly (`=== true`) so truthy non-booleans fail closed instead of open (#3169); an async `createEvent` is awaited instead of flowing downstream as a pending Promise that dropped every header the integration wrote while answering 200 (#3170); and a throwing `transformResult` on the thrown path is contained to the same sanitized 500 it produces on the return path instead of escaping the handler (#3171).
