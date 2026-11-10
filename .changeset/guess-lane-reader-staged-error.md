---
"@solidjs/signals": patch
---

fix(verdict): a reader of a guess in the guess's own lane is not marked with the truth's staged error, so a failure under an open hold no longer shows early beside readers that keep the guess (#4751)
