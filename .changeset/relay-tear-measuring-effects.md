---
"@solidjs/signals": patch
---

EFFECT_RELAY_TEAR no longer flags effects that measure layout. When the effect's apply half takes no argument (`createEffect(open, () => setFlipped(measure()))`), a write that equals the compute output is not a copy, and its tears stay advisory however often they repeat. Effects whose apply half takes the value are judged as before, so boolean mirrors still warn.
