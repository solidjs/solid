---
"@solidjs/web": patch
---

Flash falsy no-JS outcomes (`0`, `false`, `""`, `null`) instead of silently dropping them: the flash decode and the no-JS handler now decide structurally (result presence, `Response` shape) rather than by truthiness, and dispatch no longer erodes a returned `null` to `undefined` on its way to the handler; an `undefined` outcome keeps its current no-cookie behavior pending ruling (#3248)
