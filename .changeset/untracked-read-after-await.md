---
"@solidjs/signals": patch
"solid-js": patch
---

Dev: warn with `UNTRACKED_READ_AFTER_AWAIT` when an async computation first reads a signal, memo, or store property after an `await`. Such reads are not dependencies, so the computation silently keeps its old result when they change. The check attributes the read to its computation through V8 async stack traces (Chromium browsers, Node, Deno, Bun; silent on other engines), runs only in dev builds, keeps dev settle timing identical to production, warns once per computation per signal/memo and once per store, and does not blame a continuation for reads made by effect callbacks, cleanups, or `action()` bodies it triggered.
