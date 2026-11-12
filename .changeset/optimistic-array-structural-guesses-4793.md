---
"@solidjs/signals": patch
---

fix(signals): two optimistic guesses that change an array's keys or length hold the list together again: the #4784 fall-through to a lending guess applies only to index writes that change neither (D-33)
