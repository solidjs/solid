---
"@solidjs/signals": patch
---

A write that a custom `equals` calls equal to the committed value now nets to it (D-8) while another write to the signal is staged, so it pends nothing (#4483).
