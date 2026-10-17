---
"@solidjs/signals": patch
---

Fix an optimistic row that showed, vanished and reappeared when several actions guessed the same list in quick succession: a guess made over a slot another action still holds now entangles with that action, so it stays until its own action settles instead of reverting with the earlier one.
