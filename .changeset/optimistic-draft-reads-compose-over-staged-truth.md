---
"@solidjs/signals": patch
---

Optimistic increments keep stacking after a sibling landing. With several
optimistic-store actions in flight (optimistic `votes++`, server confirm,
`refresh(store)`), the first vote's truth landing is staged into the
transaction that still retains the second vote, and that vote's increment
replays over it. A third click's draft then read the staged truth WITHOUT
the replayed override: draft reads composed live overrides only while no
pending backing existed, and `votes++` reads before the first write triggers
the view-reseed hand-off. It read base, wrote base + 1, and its override
landed on the value already on screen — the click was invisible and the
count stuck (or fell back) until truth caught up. Draft reads now compose
overrides whenever the pending backing is not the draft's own view-seeded
clone.
