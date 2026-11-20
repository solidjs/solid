---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

JSX in a later declarator of a multi-declarator statement (`const a = …, view = <div>{a}</div>`) no longer has its setup hoisted above the statement, where it read the earlier declarators before they were initialized. Its setup now runs in place, as for JSX in other expression positions. In SSR, the first declarator's hoisted setup no longer lands inside a later declarator's closure (#5102).
