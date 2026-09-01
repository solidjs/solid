---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

`validate` now fails the compile instead of warning when a template's markup would be restructured by the browser's HTML parser (#3099). Once the validator fires the emitted positional walk is guaranteed not to match the browser-built DOM (crashed or silently misplaced bindings; desynced hydration under SSR), so warn-and-emit shipped certain breakage with the diagnostic buried in server logs. Errors now point at the offending JSX (code frame in Babel, line:col in the native compiler). `validate: false` remains the opt-out.
