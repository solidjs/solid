---
"@solidjs/compiler": minor
---

Add an `optimize` option (default `false`) that constant-folds the program, removes the code a constant condition makes unreachable, and resolves Solid's control-flow components when their props decide the outcome.

Constant bindings resolve through `oxc_semantic`, so a `const` (or an unwritten `let`) folds at any scope and a same-named binding elsewhere is correctly left alone.

The pass runs before JSX is lowered, so a resolved element never reaches the generate: it pays for no component call, memo, or insert hole, and its markup joins the surrounding template.

- `<Show when>` becomes its children or its `fallback`.
- `<For each>` becomes its `fallback` for an empty array literal or a statically falsy list.
- `<Repeat count>` becomes its `fallback` for a count of zero or less.
- `<Switch>` drops statically false `<Match when>` branches and collapses to a statically true one.
- `<Dynamic component>` with a static intrinsic tag name becomes that element.

A built-in tag only folds when it resolves to Solid's own component: either nothing declares the name, or it is imported from `moduleName` or `solid-js`. The exported name decides the identity, so an alias folds as what it renamed. Elements with a spread attribute or function children are left alone, and `<Portal>`, `<Loading>`, `<Errored>`, and `<Reveal>` never fold.

Folding changes the rendered tree shape and therefore hydration ids, so a server build and its client build must pass the same value.
