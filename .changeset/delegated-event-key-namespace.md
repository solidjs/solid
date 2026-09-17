---
"@solidjs/web": patch
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

Move delegated event handlers off the `$$<type>` element key Solid 1 uses.

Solid 1 delegates from `document` and fires any `$$click`/`$$input`/… it finds while walking up from the target, so a 1.x runtime on the same page — an older embedded widget, a devtools panel built on 1.x — ran every delegated handler in a 2.x app a second time. Compiled output and the runtime now stamp `_$$<type>` / `_$$<type>Data` instead; neither version can see the other's handlers, in either nesting direction.

The key, the `_$SOLID_EVENT_OWNER` mark, and the walk rules are documented in `client.ts` as the delegated-event wire contract shared by every Solid copy on a page. Anything reading `el.$$click` directly must switch to `el._$$click`.
