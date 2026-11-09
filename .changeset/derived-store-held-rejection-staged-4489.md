---
"@solidjs/signals": patch
---

A derived store's held rejection is staged like a memo's (D-41, #4489). While a hold is open — an action holding a filter change behind a pending guess, or any transition — an untracked read of the store (a click handler on a row the screen still shows) reads the screen instead of throwing the new error; the effect's error arm, `<Errored>` and the read all see the error together at the reveal. Closes D-41's derived-store deviation (the `it.fails` pin in `error-is-an-answer.test.ts` now passes as `it`).
