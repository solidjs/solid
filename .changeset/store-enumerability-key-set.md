---
"@solidjs/signals": patch
---

A store change to only a key's enumerability now notifies key-set readers (#4671). `Object.keys(store)`, `for…in` and spread list enumerable keys only, so a key turning hidden or visible changes the key set even when its value stays the same. A `reconcile` (or a setter returning a replacement) that flipped only enumerability used to update the untracked `Object.keys(store)` but left tracked readers stale. The membership compare now counts an enumerability flip as a change, in both directions. A setter's `Object.defineProperty` on a wide store (overlay staging) had the same gap, and flipping back to enumerable also left the committed key hidden. Descriptor writes now stage on the full clone. Readers of only the key's value do not re-run.
