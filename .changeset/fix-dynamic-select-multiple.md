---
"@solidjs/web": patch
---

Preserve statically selected options when a dynamic `multiple` expression on `<select>` is initially truthy (#3179). The template parses under single-select rules before the binding effect runs, so the first truthy `multiple` write now restores selectedness from the options' defaults, matching the static attribute. Later toggles keep the live selection state, exactly like toggling the attribute on static markup.
