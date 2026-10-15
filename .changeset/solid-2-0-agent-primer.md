---
"solid-js": patch
"@solidjs/web": patch
"@solidjs/diagnostics": patch
---

Ship the Solid 2.0 primer for coding agents as the `solid-2.0` skill, emit `CHEATSHEET.md` as the `solid-2.0-cheatsheet` skill on build, give every shipped skill the `name`/`description` frontmatter the Agent Skills format requires, and add the `tanstack-intent` keyword so skill registries discover them in `node_modules`.
