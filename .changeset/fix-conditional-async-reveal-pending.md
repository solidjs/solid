---
"@solidjs/signals": patch
---

Hold conditional reveals that first observe async work started in an earlier flush. The revealing signal now stays pending until the details can commit with it, including when the reveal creates a new child reader. Preserve fresh/reset loading-boundary fallbacks and avoid opening a second transition for readers already waiting in one.
