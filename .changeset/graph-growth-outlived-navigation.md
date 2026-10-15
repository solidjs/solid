---
"@solidjs/signals": patch
---

`GRAPH_GROWTH` no longer reports a route whose correctly owned content is bigger on each visit (`/rows/1`, `/rows/3`, `/rows/5`) when leaving it disposes everything. While the check is on, each non-initial navigation also counts what outlived it — the nodes alive when it opened that are still alive at its settle — and a series reports only when it climbs both in the totals, as before, and in that count. A navigation that stays on the route pattern (only params or query change) continues the visit and is not compared. The finding's `data` gains `survived` beside `history`, and its message shows both (`owners 3 → 5 → 7 (of 6 → 10 → 14)`). Fixes #4007.
