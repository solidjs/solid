---
"@solidjs/signals": patch
---

An effect that reads a derived writable signal (`createSignal(fn)`) re-runs for that signal's write when another of its sources was written and reverted in the same batch (#4991).
