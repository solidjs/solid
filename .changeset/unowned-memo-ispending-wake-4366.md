---
"@solidjs/signals": patch
---

An unowned memo with an `isPending()` reader recomputes correctly (#4366). A module-level memo left with no reader goes dormant, and the next read wakes it with a recompute. When that read was an `isPending(m)` probe, the wake ran inside the probe's window, so the memo read its sources as the probe does, at their committed values: after an async source landed it derived from the old value (`undefined + 1`, so `NaN`), and after a source recovered from an error it kept the value from before the error. The wake is the memo's own pass (A31), the same as a pull, so it now runs outside the window.
