---
"@solidjs/signals": patch
---

Attribution: a `flush` record now lists the store property nodes an optimistic store guess changed on screen — when the guess appears and when it lifts — with their values before and after under `{ bodies: true }`, as a plain store write is listed. Observe and dev tiers only; production is unchanged.
