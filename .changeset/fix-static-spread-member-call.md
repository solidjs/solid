---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

Keep the props of a `@static` spread whose argument is a member or call expression, such as `{/* @static */ ...props.attrs}`, in DOM output.
