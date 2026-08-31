---
"@solidjs/signals": patch
---

Channel-side fan-out diagnostics (attribution parity): patch consumers are invisible to graph subscriber counts, so mass registration on one record now fires the HUGE_FAN_OUT milestones and wide dispatches fire the WIDE_WRITE warning from the channel itself (dev-only, same codes and thresholds as the graph twins). WIDE_WRITE's advice text updated for the removed selector primitive.
