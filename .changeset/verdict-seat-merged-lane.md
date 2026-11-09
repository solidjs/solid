---
"@solidjs/signals": patch
---

A render effect seated as a hold's verdict reader no longer leaves the seat when it reads a verdict lane of a transaction merged into that hold: the merged transaction's lane is the same hold's, read as the lane's value and shown with it (#4427).
