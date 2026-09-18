---
"@solidjs/web": patch
"@solidjs/h": patch
---

Type the anchor's scroll opt-out as `noscroll`, not `noScroll` (solidjs/solid-router#605). The client-navigation contract on plain `<a>` elements is spelled lowercase — `link`, `state`, `replace`, `preload` — like every other HTML attribute in these types (`novalidate`, `autofocus`, `crossorigin`), and the router documents and reads the lowercase form (`a.hasAttribute("noscroll")`); `noScroll` was the one camelCase outlier, so the spelling the router README shows was a type error. Runtime is unchanged: `setAttribute` and the HTML parser already lowercase the name, so existing `<a noScroll>` markup keeps working and only needs the spelling updated to type-check.
