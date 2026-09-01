---
"@solidjs/compiler": patch
---

Prefer a local development build (`compiler.node`) over the installed `@solidjs/compiler-*` platform package when loading the native binding. The published package ships no local binary, so a local build can only mean development — but the loader tried the platform package first, which made the monorepo's own tests (locally and in CI) silently run against the last published release instead of the code under test. A present-but-unloadable local build now fails loudly instead of degrading to the published binary.
