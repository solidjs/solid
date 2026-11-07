---
"@solidjs/signals": patch
"solid-js": patch
---

`WASTED_RECOMPUTE` now names the component prop a wasted scope read that returned the same value on every wasted run, with the component and JSX site, and suggests the memo that stops the re-runs (`createMemo(() => props.text)`); the names are in `data.unchangedReads`. In dev, while an attribution engine is installed, `solid-js` reports prop getter reads through the new optional `OBSERVE.attribution.noteRead`. Only reads the scope tracks count, and each props object is wrapped once.
