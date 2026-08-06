---
"@solidjs/web": patch
---

New rxcore hook `ssrAsyncValue`, the reactive half of the document face's value tier (DR-2 at t=0): wraps an async slot arg in a full async-aware server memo so the inline fill's read throws `NotReadyError` until the value settles, then reads as the settled value — the SSR engine's hole machinery catches and re-pulls, so the covering boundary holds exactly as it does for any pending server read. `serialize: false` keeps the memo out of the hydration payload (the arg already ships once, through the slot record). The frame sink pre-taps async iterables down to a promise of their first yield, so the hook only ever sees thenables.
