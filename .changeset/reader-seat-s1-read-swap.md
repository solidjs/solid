---
"@solidjs/signals": patch
---

Reader seat (S1 M2): the slot table is now `read`'s decision. `read`, `verdictValue` and the lane dispatch are served from the table's slot and fire the mechanisms its raise names (`applyMarks`); the old deciders (`frameRead`, `readerSeesCommitted`, `serve`, `throwShown`, `laneRead`, `enterLane`, `verdictRead`, `watchVerdict`, `provisionalVerdict`, `pendingVerdict`, `observeFlight`) are deleted from the build and kept only as the `__TEST__` oracle the shadow compares against. The packed result carries the slot in its low bits so a row with no raise is a literal; the verdict and lane-seat rows fold out of a build without those engines. No behaviour change: the differential (suites + generator 2k × 3 seeds) is clean and every generator screen matches `next`.
