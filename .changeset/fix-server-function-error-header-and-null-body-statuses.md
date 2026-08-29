---
"@solidjs/web": patch
---

Fix two server-function transport encoding issues:

- Bound the error response header value (#3093). The header is a classification label — the structured error travels in the body — so long thrown messages (nine-fold inflated by percent-encoding for non-latin1 text) no longer blow past receiver header limits and turn the application error into an unreadable response.
- Support null-body statuses (204, 205, 304) (#3095). `respond(undefined, { status: 204 })` and raw null-body `Response`s now answer with a real bodiless response at the declared status instead of a `TypeError` from the `Response` constructor that dispatch sanitized into a phantom generic error at 200. A value-carrying result on a null-body status is reported as a legible authoring error naming the status, in every build.
