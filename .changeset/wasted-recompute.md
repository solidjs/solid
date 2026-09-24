---
"@solidjs/signals": patch
---

`WASTED_RECOMPUTE` (warn, perf): a scope whose runs in a window were mostly no-ops — inputs changed, the result compared equal, the compute was discarded — named with the input that keeps triggering it. The sixth cost check under `checks`; `wastedRecompute: { minRuns, ratio, budgetMs, windowMs } | false` configures it.
