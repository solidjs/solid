---
"@solidjs/babel-plugin": minor
"@solidjs/compiler": minor
---

Patch mode is now the default in both compilers: eligible pure member-read
bindings compile to `patchDriver` templates and eligible store lists to
`rowProof` rows without any configuration. Opt out with `patchDriver: false`.
