---
"@solidjs/compiler": patch
"@solidjs/babel-plugin": patch
---

`sourceNames` follows `dev` in both JSX compilers. Unset, every kind (`components`, `bindings`) is on when `dev: true` and off otherwise; `true`/`false` sets every kind (`sourceNames: false` opts a dev build out); the object form picks, and each kind it leaves unspecified follows `dev` (previously `false`). Production output (`dev: false`) is byte-identical with the option set or unset. `@solidjs/babel-plugin`'s `PluginConfig.sourceNames` is now optional. Dev builds label components (`createComponent(Home, props, "Home")`) and binding effects (`span.children`) out of the box, so diagnostics and the Performance panel read as source without build-tool configuration.

Primitive naming (`createSignal(0, { name: "count" })`) stays with `@solidjs/compiler`'s standalone `transformSourceNames` pass, which the build tool runs on every module independently of the JSX compiler; it is not a JSX-transform kind, and the READMEs and RFC now say so.
