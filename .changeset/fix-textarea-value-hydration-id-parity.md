---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

A `<textarea>` with a dynamic `value`/`defaultValue` no longer desyncs hydration ids for the siblings after it (#3691). The server folds the value into the textarea's text content, and that fold was taking the `_$scope` hydration-id reservation a dynamic child hole gets — but the client writes the value as a plain property effect that never allocates an id, so every component after the textarea hydrated one id off and its updates targeted detached DOM. The fold is now treated like the `innerHTML`/`textContent` redirects (#3015): opaque content, no id reservation, in both the Babel plugin and the native compiler.
