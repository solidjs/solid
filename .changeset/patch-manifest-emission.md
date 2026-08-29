---
"@solidjs/signals": patch
"@solidjs/web": patch
"@solidjs/babel-plugin": minor
"@solidjs/compiler": minor
"@solidjs/universal": patch
---

Patch templates now emit a STATIC read manifest (re-audit 7): every member
path the compiled body can read — ternary/logical branches and nested chains
included — hoisted to one module-scope array per distinct manifest
(`var _mf$ = ["flag", "a", "queries.0.elapsed"]`) and passed as
`patchDriver`'s third argument. The runtime's accessor-demotion probes use
this complete envelope; runtime read-recording could never see an untaken
branch. Eligibility tightens accordingly: standalone `{subject}` reads and
string keys containing "." compile classic. `@solidjs/universal`'s
documented `Renderer` interface now includes the `patchDriver` member
`createRenderer()` has always synthesized.
