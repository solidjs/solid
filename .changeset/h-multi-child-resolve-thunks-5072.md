---
"@solidjs/h": patch
---

fix(h): resolve tagged `h()` thunks in a component's multi-child array. Before, `componentProps` passed the raw thunk array through, and `insert` read its elements as accessors and re-invoked them on every signal change, re-creating child components. The children array is now exposed through a getter that resolves thunks in the consumer's scope, matching the single-child getter path. Note: `h.Fragment` with multiple children now returns resolved DOM nodes instead of the original thunks (#5072).
