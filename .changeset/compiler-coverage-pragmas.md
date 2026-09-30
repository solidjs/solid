---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

Preserve `/* istanbul ignore … */` and `/* c8 ignore … */` block comments written as JSX children on the generated component `children` getter. Line comments are not carried.
