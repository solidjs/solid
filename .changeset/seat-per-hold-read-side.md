---
"@solidjs/signals": patch
---

A verdict posture is per hold (D-25 as amended): a pass that probed (`isPending`/`latest`) or read a verdict memo is a verdict reader only while something it asked about is still held. The probed nodes are remembered per node and resolved to their holds at use, so a probed hold's landing releases the posture; toward a later, isolated hold the node is whatever its reads make it (#4393, #4491, #4504, #4544 clause).
