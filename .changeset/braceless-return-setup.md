---
"@solidjs/babel-plugin": patch
---

Keep a returned element's setup inside a braceless `if`, `else` or loop body. `if (c) return <span>{x.join()}</span>;` emitted the template clone and `insert` before the `if`, so they ran (and `x.join()` threw) when `c` was false, a loop body's setup read its loop variable out of scope, and a hydrating `getNextElement` claimed a node for a branch not taken. The setup is now inserted before the `return`, and Babel wraps the body in a block.
