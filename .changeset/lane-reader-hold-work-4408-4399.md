---
"@solidjs/signals": patch
---

An async memo over two verdict memos asks each question once, and a lane's readers show its answer together (#4408, #4399; F-6, F-9, D-25, D-26).

- An async memo with no verdict window of its own that waits on a source's flight as the hold's work (`holdWork`) drops its verdict posture at the wait, so the source's verdict-lane re-derive does not move it into that lane early, and the pass the landing runs reads plainly. Before, `latest(m2)` showed `c1101` while `m1:1122` of the same lane was still in flight.
- A held memo's pass that re-entered its hold at its head stays that hold's work when it reads another hold's verdict lane, in either read order. Before, moved into the other lane, it read its own hold's landing as the screen and asked `m1:15` a second time.
