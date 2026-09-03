---
"@solidjs/web": patch
---

Refuse `-0` on the JSON fast path. `isJSONSafe` turns away every number `JSON.stringify` cannot spell faithfully except this one: `JSON.stringify(-0)` is `"0"`, so a result of `-0` arrived as `+0` while the codec, which encodes it correctly, was never reached. The same quiet corruption the neighbouring branches already refuse.
