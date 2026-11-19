---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

Collapse only ASCII whitespace in a static `<option>`'s text when SSR matches it against a bound `<select value>`, so text with `&nbsp;` or other non-ASCII whitespace matches and renders `selected`.
