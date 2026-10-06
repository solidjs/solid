---
"@solidjs/babel-plugin": patch
---

SSR `hoistProps` skips TypeScript type positions when collecting captures, so on authored TSX (types parsed, stripped later) a `typeof x` query or a type named like a value no longer captures that value, or forces the literal fallback when it is reassigned (#3828).
