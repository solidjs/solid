---
"@solidjs/web": patch
---

SSR: `ssrElement`'s spread walk keeps its pre-slot shape on the hot path. Attribute-slot handling — a `class`/`style` object, a stand-in at an attribute or behavior key, a slot's return among the sources — moves into helpers reached only for object values and non-literal sources; a string `class`/`style`, a plain attribute and a plain source cost what they did before slots (`spread-static-tail` bench: the two-source forms had regressed 7–28%).
