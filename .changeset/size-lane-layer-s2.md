---
"@solidjs/signals": patch
---

Size audit (measurement branch): §28 S2 — verdicts and consolidation on the rebuilt lane layer. The verdict watchers merge into the lane layer's staged-readers list (one seam, one rule: a pass that read this flush's staging as the screen re-derives if the frame parks); one `staleReader` registration shared by frame reads, lane reads and verdict routes; `dissolveLane` restructured by outcome, every guess of a dissolving lane re-homed with its truth. No behavior change; 0 pins moved.
