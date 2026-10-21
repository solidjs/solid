---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

A valueless `prop:` attribute (`<el prop:active />`) now compiles as `prop:active={true}`, matching bare plain attributes, instead of being dropped silently (#4180).
