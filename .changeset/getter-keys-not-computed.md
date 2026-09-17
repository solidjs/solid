---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

Emit non-identifier getter keys in compiled props literals as string literals (`get "aria-label"() {}`) instead of computed keys (`get ["aria-label"]() {}`). Same property, but a computed key drops the whole object literal off V8's boilerplate path into per-property runtime definition; on a seven-getter props literal the computed form costs ~45% more to build. Applies to every getter site in both compilers: component props, dynamic element attributes (DOM, SSR, universal).
