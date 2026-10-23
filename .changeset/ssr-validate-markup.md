---
"@solidjs/compiler": patch
---

Validate SSR templates for malformed HTML under the `validate` option, as DOM templates already are, so markup that only compiles for the server (such as server components) reports the same compile error.
