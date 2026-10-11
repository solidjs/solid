---
"@solidjs/signals": patch
---

A `createProjection` whose re-run throws synchronously (for example, reading an entry that has since failed) now delivers the error to the readers of its fields, so the nearest `<Errored>` shows it instead of the screen keeping the last good value.
