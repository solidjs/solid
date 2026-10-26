---
"solid-js": patch
---

`<Repeat>` with element (non-function) children no longer builds each row twice. It read the `children` getter once to check for a function and again for the value, so every row's JSX ran twice and its refs fired twice (#4296).
