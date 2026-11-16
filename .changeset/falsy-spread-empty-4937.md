---
"@solidjs/signals": patch
"@solidjs/web": patch
---

A reactive spread that evaluates to a falsy value (`{...(cond() && { k: 1 })}`) contributes no props, as `{}` does, on components and elements, on the client and the server (#4937). Since rc.9 it threw `Cannot use 'in' operator … in false` and halted reactivity: function sources were only checked for nullish values.
