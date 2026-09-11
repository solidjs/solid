---
"@solidjs/signals": patch
---

Optimistic and `latest()` lanes now hold under the same rule as transactions: async derived from the lane holds the lane's reveal only when a render effect observes it pending and no `Loading` boundary catches it. An async memo nobody renders, or one inside a boundary that shows its fallback, no longer blocks the lane (#3289).
