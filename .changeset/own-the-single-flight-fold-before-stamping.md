---
"@solidjs/web": patch
---

Adopt a `transformFlightResult` Response via the ownership seam (`ownResponse`) before stamping the mutation's cookies and accumulated headers onto it, so a Response the integration retains (a memoized shell) never accumulates one caller's session cookies and serves them to the next (#3234, completing #3155)
