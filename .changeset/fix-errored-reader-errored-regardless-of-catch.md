---
"@solidjs/signals": patch
---

A computation whose pass reads an errored memo is errored with it whether or not its body catches the throw (F-12, #4410, #4486). Previously a `try/catch` around the read completed the pass with a value, so the error escaped the boundary and, at the next change, the reader was marked errored by propagation with its catch never running — halting the system without a boundary.
