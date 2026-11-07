---
"@solidjs/compiler": patch
"@solidjs/babel-plugin": patch
---

The server build escapes string literals in a ternary branch, after `&&`, and in a function child's return. The server now renders them as text, as the client does, in children and in attribute values (#4710).
