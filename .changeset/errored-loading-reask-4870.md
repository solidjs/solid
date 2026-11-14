---
"@solidjs/signals": patch
---

fix(signals): a failed async memo under `<Errored>` is no longer re-asked on every flush when a `<Loading>` beside it reads it through `latest()`: behind a shown error fallback, a loading boundary whose reader answered with that error keeps its fallback instead of revealing (#4870, regression from #4634)
