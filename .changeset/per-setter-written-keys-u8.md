---
"@solidjs/signals": patch
---

fix(signals): a later mainline store setter that does not write a held key publishes on the mainline tick — a setter's written keys are its own set, so its notify visits only the keys it wrote (D-8, U-8, #3743)
