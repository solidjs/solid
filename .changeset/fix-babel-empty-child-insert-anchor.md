---
"@solidjs/babel-plugin": patch
---

Keep source order in DOM output when a child that renders nothing, such as `{""}` or trailing spaces before a line break, sits between a dynamic child and the next node.
