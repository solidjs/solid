---
"@solidjs/compiler": patch
---

Numbers inlined into templates now print the way JS `String(number)` does, as Babel's output does. Before, any whole number of 2^63 or more saturated to `9223372036854775807`, and very large or very small values never switched to exponent form. Now `{1e21}` prints `1e+21`, `{1e19}` prints `10000000000000000000` and `{1e-7}` prints `1e-7`. A child hole now also folds `-`, `*` and `/` the way an attribute does, so `<div>{1 / 0}</div>` puts `Infinity` in the template instead of inserting `1 / 0` at runtime (#4322).
