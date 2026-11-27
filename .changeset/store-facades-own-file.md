---
"solid-js": patch
---

`createStore`, `createOptimisticStore` and `createProjection` ship in their own file (`dist/solid.store.js`, beside `solid.js` and `solid.observe.js`), so an app bundler can put them and the store engine they import in the lazy chunk of the route that uses them. With one flat `solid.js`, a store used only by a lazy route put the whole store engine in the entry chunk: about 7.4 KB brotli for `createStore` and 12.6 KB for `createOptimisticStore` under Vite 8.
