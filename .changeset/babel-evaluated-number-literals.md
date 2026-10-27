---
"@solidjs/babel-plugin": patch
---

Evaluated negative and non-finite numbers (`c={-1}`, `d={NaN}`) are static again. Since Babel 8 support, `evaluateAndInline` built them with `t.valueToNode`, which gives `-1` / `0 / 0` expressions rather than numeric literals, so they stopped being inlined into templates (SSR emitted `ssrAttribute("c", -1)` instead of `c="-1"`) and diverged from `@solidjs/compiler` (the parity probes' "exotic literal holes"). They are now NumericLiteral nodes again, built directly where @babel/types 8's builder would reject the value; both Babel majors print them as before.
