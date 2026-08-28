---
"@solidjs/web": patch
---

The list driver's identity matching unwraps store proxies on both sides — draft-authored permutations store row proxies verbatim, and matching them against raw records rebuilt every surviving row (caught by the JFB keyed-reorder identity gate).
