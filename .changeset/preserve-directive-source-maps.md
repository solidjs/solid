---
"@solidjs/compiler": patch
---

Fix directive transform source maps to point to the original input by running dead-code elimination on the existing AST instead of printing and reparsing between passes.
