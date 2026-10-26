---
"@solidjs/signals": patch
---

A render effect that reads `latest(s)` before an async value that has never shown now holds its mount the same way the reverse read order does: an earlier `latest()` read no longer turns the later unready read into waiting lane work, so a newly mounted branch (for example under `<Show>`) stays unpublished until the value lands instead of appearing with an empty slot (S-39, D-28) (#4275).
