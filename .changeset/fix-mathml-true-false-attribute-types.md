---
"@solidjs/web": patch
"@solidjs/h": patch
---

The JSX types for MathML attributes whose values are the strings `"true"` and `"false"` (`displaystyle`, `stretchy`, `largeop`, `movablelimits`, `symmetric`, `fence`, `separator`, `accent`, `accentunder`) now accept those strings and reject `{true}`, the bare attribute and `""`, which write an empty value that MathML ignores, as well as `boolean`-typed values. `{false}` still removes the attribute.
