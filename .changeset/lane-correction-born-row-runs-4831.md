---
"@solidjs/signals": patch
---

Rows that a held optimistic lane built keep their text when a correction ends the lane: a render effect born in that frame now runs on the committed values instead of losing its first run with the lane's parked runs (#4831).
