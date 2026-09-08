---
"@solidjs/signals": patch
---

Add a development CJS build, `dist/node.dev.cjs`, selected by the `development` condition on the `require` branch of `exports`. Previously `require` always resolved to the production `dist/node.cjs` (`__DEV__` false), so a CJS host that resolved `solid-js`'s dev server artifact would get `DEV === undefined` from its `@solidjs/signals` dependency — a dev server runtime whose diagnostics channel was silently absent. Dev CJS is the unmangled twin of `dist/dev.js`; the production CJS is unchanged.
