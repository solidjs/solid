---
"@solidjs/compiler": patch
---

Native compiler: `$key` on an intrinsic element with a spread (`<li $key={id} class="todo" {...attrs}>`) now follows the same rule as on a template element — SSR compiles it to the `_key` attribute the frame morph matches keyed elements by, and a DOM compile strips it. It previously passed through the spread path unrenamed, so server markup carried a literal `$key` attribute and keyed morphs lost identity. Babel already behaved this way; the shared `keyedElements` fixtures pin the spread case for both.
