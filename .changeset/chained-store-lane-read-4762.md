---
"@solidjs/signals": patch
---

A projection whose function returns another store as is now reads that store's values after a switch made while a guess is out (#4762). The outer store's own nodes still carried values from an earlier pass in the guess's lane. Once the store was chained, those values covered the inner store, so `length` and a row of the old list were served beside the new list's rows. A chained store's nodes now read through to the inner store. Guesses on an optimistic store are still served first.
