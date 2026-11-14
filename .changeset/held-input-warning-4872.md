---
"@solidjs/web": patch
"solid-js": patch
---

dev: `UNCOMMITTED_INPUT_OVERWRITTEN` also names a held write (a controlled input whose signal write is held while async work that reads it is pending, re-applied when a sibling `isPending` binding flips) and points to `value={latest(q)}` (#4872)
