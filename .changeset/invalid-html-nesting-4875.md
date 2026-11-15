---
"@solidjs/web": patch
"@solidjs/signals": patch
---

feat(web): dev warns `INVALID_HTML_NESTING` when hydration claims an element the browser's HTML parser moved out of its parent (invalid nesting across a component boundary: `<div>` in `<p>`, `<a>` in `<a>`, `<tr>` straight in `<table>`); the key-miss warning for a `<form>` names a form nested in a form (#4875)
