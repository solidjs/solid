---
"@solidjs/compiler": patch
"@solidjs/babel-plugin": patch
---

The server build escapes string literals in a ternary branch, after `&&`, and in every `return` of a function child, including a `return` inside `if`, `switch`, `try` or a loop. The server now renders them as text, as the client does, in children and in attribute values (#4710). A function value in an attribute keeps its literals as written at every depth, because the server stringifies its source.
