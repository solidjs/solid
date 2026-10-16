---
"solid-js": patch
---

`createComponent(Comp, props, name?, loc?)` takes the JSX site the compiler emits beside the tag (`"src/App.tsx:12:5"`); the dev and observe component owner carries it on both the client and the server, so a finding raised inside a component reports `at src/App.tsx:12:5` (and `event.loc`) when nothing closer was located. The console footer is now two lines: the code's docs page for a human (`what it means and how to fix it: https://v2.solidjs.com/reference/solid-js/diagnostics/<slug>`), then the repair skill for an agent (installed path and GitHub URL, anchored to the code's section). `diagnostics.json` links each code to its docs page, and the `reactivity-diagnostics` skill documents the `at` line.
