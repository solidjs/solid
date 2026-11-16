---
"@solidjs/compiler": patch
"@solidjs/babel-plugin": patch
---

A production `<Show>` whose callback reads its value (`{u => <p>{u()}</p>}`) is lowered to a ternary only when `when` reads signals, memos, stores, names, literals and operators. A `when` that reads another object's member, such as a prop, keeps the component (#4936): the ternary wrote `u()` as a second read of `when`, and a prop's getter runs again on each read, so `when={props.children}` created the child twice and broke its hydration. JSX children without a callback still lower for any `when`.
