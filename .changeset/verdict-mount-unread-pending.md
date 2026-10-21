---
"@solidjs/signals": patch
---

A `<Loading>` that a verdict reader (`<Show when={latest(x) ?? x()}>`) mounts reveals its content again when a component inside it writes a signal during its mount and creates a memo that reads it and stays pending with no reader: that memo holds nothing and reaches no boundary (#4203, a regression from #4166's fix).
