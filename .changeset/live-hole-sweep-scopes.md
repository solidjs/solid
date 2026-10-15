---
"@solidjs/web": patch
---

Live holes keep updating when their markup creates reactive scopes (a nested `<For>`, a compiler condition memo such as `{m.usage && …}`, a component). Each re-render runs in a throwaway scope disposed once its markup is out; only a scope still waiting on async work closes the hole (#4023).
