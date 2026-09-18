---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

SSR: a component's props literal with getters compiles to a module-level constructor with shared getters (`hoistProps`, default on) instead of an object literal, which V8 builds in dictionary mode with a closure per getter per instance. Same own keys, order, descriptors and prototype; a props getter is now defined only for a read through its own object — copying its descriptor elsewhere throws (dev names the rule). Sites closing over a reassigned or later-declared binding, `this`, or `arguments` keep the literal. Babel and the native compiler emit the same output.
