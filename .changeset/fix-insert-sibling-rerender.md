---
"@solidjs/web": patch
---

Fix unnecessary sibling re-rendering when Show/conditional children update by wrapping insert accessor in a transparent memo, with reactive accessor detection to skip redundant memoization
