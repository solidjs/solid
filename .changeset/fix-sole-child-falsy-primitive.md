---
"@solidjs/web": patch
---

Remove a sole text child of `0` or `NaN` when that hole is replaced with an element, an array, or other content. Those values stay tracked as the raw primitive, and the old truthiness checks skipped cleanup, so the text node was left in place and zeros accumulated on later toggles.
