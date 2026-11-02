---
"@solidjs/signals": patch
---

Clear the settled source at `propagateStatus`'s verdict re-derive shortcut: a verdict reader (`isPending`/`latest`) whose probed source errored kept that source in its pending set, so when its re-run parked on a second source, that source's landing left the reader pending forever (and a `Loading` boundary over it never released).
