---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

Escape static text on SSR spread elements (#3557)

- Static text children of a spread element (`<div {...props}>a &lt;b&gt;</div>`) are now HTML-escaped at compile time in both compilers, matching the template path; `script` and `style` children stay raw.
- A static textarea `value` folded into the template (`<textarea value="a &lt;b&gt;" />`) is escaped in both compilers.
- The Babel plugin no longer folds a textarea `value` into children on an element that carries a spread, so the value stays a prop and precedence follows JSX source order, matching the native compiler.
- Static string props on the Babel spread paths are rebuilt from their decoded value, so `<div {...props} title="a &amp; b" />` no longer double-encodes entities.
