---
"@solidjs/web": patch
---

Refuse to flash when no storable cookie exists for a no-JS outcome (#3249). The degrade ladder (#3137) bounds the input echo and the result but never looked at `url` — pathname + search of a request the caller chose — so a long enough form action pushed the fully-degraded payload past the ~4 KB cookie ceiling and the encoder emitted a cookie the browser discards whole, with `truncated: true` inside asserting a degradation that never stored. `encodeFlashCookie` now returns `null` when even the degraded payload cannot fit, and the no-JS handler falls back to the plain redirect — never an oversized cookie, never a url truncated to a prefix that would attach the outcome to a submission it does not identify. Cookie naming, attributes, and refusal/redirect statuses are untouched (#3239, #3250 pending).
