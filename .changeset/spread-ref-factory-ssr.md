---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

SSR evaluates a `ref` expression beside a spread, as it already does without one, so a ref factory's owned setup (`ref={tooltip()}`) runs on the server too and the hydration ids after it line up. The ref itself is still never called on the server (#4081).
