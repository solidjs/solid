---
"@solidjs/web": patch
---

A text value that shares its parent with other children (`<p>Count: {n()}</p>`) no longer reads the text node's `.data` before each write. The node remembers the last value written and later updates compare against that, which takes a signal-driven text update from about 0.59 µs to about 0.35 µs. The first write to a node still compares with the DOM. One behavior difference: if something outside Solid rewrites such a text node and the value then re-evaluates to what Solid last wrote, the text is no longer written back.
