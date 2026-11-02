---
"@solidjs/signals": patch
---

A `<Loading on>` re-arm whose content reads its async through an error boundary built outside the `<Loading>` shows its fallback with the change's frame again, beside a sibling re-armed boundary (#4638). A pending error-boundary output read only behind fallbacks no longer holds the frame.
