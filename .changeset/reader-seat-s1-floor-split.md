---
"@solidjs/signals": patch
---

The reader seat's table is split by engine: `seat.ts` keeps the plain rows (a pass in no seat reading a node that is no lane's), and the rows of a seated pass and of a verdict reader move to the lane engine (`seatRows`), installed through the hook that carried the lane rows. A build without the lane engine retains neither.
