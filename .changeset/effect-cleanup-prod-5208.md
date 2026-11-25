---
"@solidjs/signals": patch
---

In production, an effect that returns a non-function cleanup no longer stores that value. The next run used to call it and halt the reactive system. Development still throws on the run that returned it.
