---
"@solidjs/compiler": patch
"@solidjs/babel-plugin": patch
---

DOM output no longer declares positional walks to nodes nothing reads. A text node ahead of an appended expression, like `User : ` in `<h1>User : {name()}</h1>`, used to get `var _el$3 = _el$2.firstChild` even though the insert appends with a `null` marker. A minifier keeps that property read, since it could be a getter, so it shipped as `_el$2.firstChild;`. Both compilers now drop a `firstChild`/`nextSibling` walk when no later statement reads its node, including a walk that only fed another dropped walk.
