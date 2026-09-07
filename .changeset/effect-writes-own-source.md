---
"@solidjs/signals": patch
"solid-js": patch
---

Attribution: `EFFECT_WRITES_OWN_SOURCE` diagnostic. An effect whose callback writes a value its own inputs depend on converges (the second run finds nothing to change) rather than looping, so the flush guard never fires — yet the flush settled in two passes and the screen rendered the pre-write value in between. The engine now walks each effect re-run's cause chain (root writes, through any depth of memos) and, when a root write's effect origin resolves to the effect that is re-running, reports the cycle once: `warn` for a single effect (the written value is a function of what the effect reads — make it a memo, or normalize where the source is written), `info` for a cycle relayed across several effects (each effect-origin write is joined to the run that made it, so the walk continues hop by hop). Effect-origin `ChangeOrigin` frames gain `run`, the `RerunEvent.run` whose effect phase performed the write. The `reactivity-diagnostics` skill documents the code and repair.
