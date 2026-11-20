---
"@solidjs/compiler": patch
"@solidjs/babel-plugin": patch
---

JSX in a later declarator of one declaration (`const a = …, b = <div>{a}</div>`, the shape minifiers make by joining declarations) no longer has its setup hoisted above the whole declaration. The declarators before it split into their own statement, so the setup runs after them instead of reading them before initialization.
