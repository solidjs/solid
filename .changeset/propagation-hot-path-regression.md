---
"@solidjs/signals": patch
---

Recover propagation hot-path cost introduced by the cold-field extension split. markNode's firewall-children walk gates on a CONFIG_FW_CHILDREN bit instead of dereferencing the extension per marked node, and setSignal reads the extension once instead of re-chasing it per optional check. Statistical A/B (6x6 interleaved) showed the split had cost diamond propagation ~22% and equality-skip chains ~14%; these gates recover the extension-split's own share. Quiet-machine isolation (8x2 interleaved) attributes the remaining -10-20% on repeated-write propagation shapes to the earlier shape-alignment increment (config-bit gates + literal slots) — a characterized trade against its measured write-path and creation wins, tracked for CodSpeed adjudication. _transition also returns to the core literal (consulted on every write; the sweep had wrongly demoted it).
