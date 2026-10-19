---
"@solidjs/web": patch
---

An insert decides whether its inner effect's first run is inline (the first render) or scheduled into the effect phase (any later render) from a flag, not from the previous computed value. A hole that was an element's only child normalizes to `undefined` while it renders nothing, which read as "never ran": content arriving there later — a `<Show>` flipping to a branch whose reads are held by an action — ran its inner effect inline, mid-compute, and mounted ahead of the hold (an enabled, empty input before the commit, against D-23). Multi-slot holes, whose normalized value is always an array, already scheduled correctly; single-child holes now match.
