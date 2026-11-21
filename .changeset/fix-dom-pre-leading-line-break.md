---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

Keep the DOM template walk in step with the HTML parser when a `<pre>` or `<listing>` holds a line break the parser drops after its start tag, so a lone leading `{"\n"}` or `&#10;` no longer breaks rendering, hydration, or event handlers.
