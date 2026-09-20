---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

Static text children of a spread element (`<div {...props}>a &lt;b&gt;</div>`) are now HTML-escaped at compile time in both compilers, matching the template path; `script` and `style` children stay raw, including a static string expression child such as `<script {...props}>{"a < b"}</script>`, which the Babel plugin previously escaped. A static textarea `value` folded into the template (`<textarea value="a &lt;b&gt;" />`) is escaped the same way. The Babel plugin no longer folds a textarea `value` into children on an element that carries a spread: the value stays a prop of the running source object, so a static written after the spread wins (previously the spread's value always won) and the runtime escapes it, matching the native compiler. The Babel plugin also rebuilds static string props of spread elements from their decoded value, so `<div {...props} title="a &amp; b" />` no longer passes the raw entity text to the runtime.
