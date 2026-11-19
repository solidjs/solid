---
"@solidjs/signals": minor
---

Experimental: `openView()` from `@solidjs/signals/attribution` (and `solid-js/attribution`) shows a chosen past frame of the page for time-travel devtools. While a view is open every flush joins one hold that only the view closes, so the program keeps running beneath it unseen; `view.show(map)` pins nodes at the given values as ordinary optimistic guesses over that hold, and sync derivations, render effects and structure re-derive from the pins. `view.resume()` lands everything done beneath the view as one transition (returning `false` while it waits on async work; poll `view.landing()`), and `view.branch()` makes the shown values the truth instead. User effects wait for the landing unless `openView({ effects: true })`. Observe and dev tiers only; the prod build resolves an inert twin.
