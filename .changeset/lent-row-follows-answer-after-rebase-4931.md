---
"@solidjs/signals": patch
---

A row one keyed optimistic store's guess took from another store by reference keeps following that store's answers when an unrelated write re-derives the store it was guessed into (#4931). A move that appended Doing's row to Done showed the row's old `2/2` once an action's answer also rewrote Done, while Doing's answer said `2/3`: the re-base of the move's guess over Done's new answer rebuilt the arrangement from the guess's unwrapped rows, so the lent row became Doing's old raw object, frozen at the value it had when the guess was written. A structural guess now keeps a lent row as the lender's proxy.
