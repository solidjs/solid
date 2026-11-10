---
"@solidjs/signals": patch
---

`createOptimisticStore`: a setter that returns a new array is written as the keyed diff of what it changed, so it reads the same at every frame as the equivalent field write (#4737, #4739). While guesses are out, a landing keeps every keyed row's proxy, so a row whose earlier guess settled can be guessed again and shows (#4738).
