---
"@solidjs/web": patch
---

Run `transformResult` for plain thrown errors as its documentation already promises: the hook now runs once at the thrown path's entry (`context.thrown` set) for every thrown value — not only thrown Response/envelope shapes — and the response tail is selected from its output, while the wire stays sanitized and a hook that itself throws is contained as a sanitized 500 (#3247).
