---
"@solidjs/compiler": patch
---

The Rust compiler core exports `compile_program`, an entry point that compiles an Oxc `Program` the caller has already built instead of source text. It is `compile` with the parse step split off: the program goes through the same `dom` / `ssr` / `universal` / `dynamic` back ends, with the same `requireImportSource` gate and coverage-pragma handling, so a frontend that produces an AST (rather than projecting to JSX text) gets the shared lowering and source maps on its own authored positions. `source` must be the program's `source_text`. Additive and Rust-only: `compile` and the Node `transform()` are unchanged (the shared back half is factored out of `compile_inner`; the TSRX route reaches it with its extracted stylesheet as before).
