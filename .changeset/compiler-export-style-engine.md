---
"@solidjs/compiler": patch
---

The Rust compiler core exports TSRX's scoped-CSS engine as `solidjs_compiler::style`, moved from `src/tsrx/style/` to `src/style/` so it is available without the `tsrx` feature: `compile_style`, `compile_style_with_class_map_selectors`, and their input and output types (`StyleInput`, `StyleLocation`, `StyleKind`, `Element`, `ElementKind`, `ElementChild`, `Attribute`, `AttributeValue`, `StyleOutput`, `ClassMapEntry`, `StyleError`). The engine already had no dependency on the TSRX frontend; exporting it lets another frontend (one that does not use TSRX at all) scope a `<style>` block over its own elements and get the same stylesheet and hash a `.tsrx` file gets. Additive and Rust-only: the TSRX route and the Node `transform()` are unchanged.
