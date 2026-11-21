---
"@solidjs/signals": patch
---

Fix optimistic store guesses on unchanged keys of a held container inheriting an unrelated hold so declined guesses revert when their own truth lands.
