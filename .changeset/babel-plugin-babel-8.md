---
"@solidjs/babel-plugin": patch
---

Support `@babel/core` 8 alongside 7: the peer range is now `^7.20.12 || ^8.0.0`. SSR no longer reads `Scope#uids` (removed in Babel 8), evaluated negative or non-finite numbers are built with `valueToNode`, `import()` parsed as `ImportExpression` stays dynamic, and TSRX emits the AST shape of the running Babel major (type arguments, type parameter names, `import()`, enums, heritage). TSRX also keeps `import()` options and class method type parameters, which it dropped before.
