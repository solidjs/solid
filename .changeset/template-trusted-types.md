---
"@solidjs/web": patch
---

`template()` now creates its markup through a Trusted Types policy named `solid`, so compiled JSX renders on pages that enforce `require-trusted-types-for 'script'`. Allow it with `trusted-types solid` in the Content Security Policy. Pages without Trusted Types behave as before.
