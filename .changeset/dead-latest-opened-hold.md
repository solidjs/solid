---
"@solidjs/signals": patch
---

Remove the "transaction only a `latest()` read opened" arm (`latestOpened` / `openedByLatest` and the `stagedScreen` test on it). `latest()` has opened no transaction since #4393, so the flag was never set and the arm could never run; a coverage inventory across every suite and 150,000 generator cases confirmed it (reader-seat-rebuild.md §9.5). No behavior change; −63 B minified on the `isPending`/`latest` chunk.
