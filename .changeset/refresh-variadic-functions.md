---
"@solidjs/compiler": patch
---

The refresh pass no longer wraps a capitalized function with a rest parameter as a component. A component takes at most its props, and the HMR proxy calls the wrapped function with only its first argument, so in dev a variadic helper like `function Format(...parts)` received only the first argument (vite-plugin-solid#214).
