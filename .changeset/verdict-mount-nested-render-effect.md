---
"@solidjs/signals": patch
---

A `<Loading>` that a verdict reader (`<Show when={latest(x) > 0}>`) mounts during a held action now holds a render effect nested in its content, not only a direct read: it shows its fallback beside the committed value until the action lands (#4166).
