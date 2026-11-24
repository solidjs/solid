---
"@solidjs/web": patch
---

An empty `revalidate` declaration (`[]` or `""`) is now sent as `X-Revalidate: ,` instead of an empty header value, which intermediaries such as CDNs drop, turning "revalidate nothing" into "revalidate everything".
