---
"@solidjs/signals": patch
---

A row one store's guess moves into another store as it is (that store's proxy) keeps its proxy when the second store's re-ask lands with the same key (#4902). The landing used to make a fresh row there, so when the move's action ended the row showed the server's values and a guess still out on it from the first store (a toggle) disappeared until its own action ended. The lent row's target now adopts the server object, as a row a guess added does, and the toggle's guess shows on through it until its action ends.
