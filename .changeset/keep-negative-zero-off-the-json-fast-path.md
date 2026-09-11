---
"@solidjs/web": patch
---

Keep `-0` off the server-function JSON fast path. `JSON.stringify(-0)` is `"0"`, so a signed zero admitted by `isJSONSafe` rode the fast path and arrived as `+0` — a silent sign flip on the exact guard that already refuses `NaN` and the infinities for the same reason. `-0` now answers "not JSON-safe" and rides the codec, which spells it exactly, on both legs (argument lists and results).
