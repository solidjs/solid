---
"@solidjs/web": patch
---

Server-function calls that end in a string no longer turn an earlier `undefined` argument into `null`. `search(1, undefined, "milk")` took the bound form-post path, which moves the leading arguments into `?args=` as JSON, so the function ran with `limit = null` and its default parameter never applied. A trailing string now goes through the codec like any other argument list that JSON cannot carry: with `enableRichArguments()` the function receives `undefined`, and without it the call throws the same "sent as JSON by default" error as `search(1, undefined)`. Bound form actions (`action.with(id)` posting FormData, URLSearchParams or a File) keep the `?args=` shape and still send `undefined` as `null`, which matches the no-JS action url.
