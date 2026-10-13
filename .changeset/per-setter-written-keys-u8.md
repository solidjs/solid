---
"@solidjs/signals": patch
---

fix(signals): a later mainline store setter that does not write a held key publishes on the mainline tick — a written key carries the setter generation that wrote it, so a setter's notify visits only its own keys (D-8, U-8, #3743)
