---
"@solidjs/signals": patch
---

Recover propagation hot-path cost introduced by the cold-field extension split. markNode's firewall-children walk gates on a CONFIG_FW_CHILDREN bit instead of dereferencing the extension per marked node, and setSignal reads the extension once instead of re-chasing it per optional check. Statistical A/B (6x6 interleaved) showed the split had cost diamond propagation ~22% and equality-skip chains ~14%; these gates recover roughly half, with the remainder under continued investigation.
