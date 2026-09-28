---
"@solidjs/web": patch
---

Fix SSR `class` and `style` objects rendering a leading separator when their first entry is skipped (`class=" on"`, `style=";top:1px"`). `ssrClassName` and `ssrStyle` added the separator by loop index; it now depends on what was already written.
