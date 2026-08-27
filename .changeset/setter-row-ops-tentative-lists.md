---
"@solidjs/signals": minor
"@solidjs/web": minor
---

Close two list-driver coverage gaps found by the JFB store scenario: setter-
channel structural mutation (push/splice/index assignment/permutation) now
emits identity-keyed row ops at the fold — a driven list stays DOM-correct
for stores mutated without reconcile — and empty-initial lists engage
TENTATIVELY, deferring the purity probe to the first created row, with a
late decline handing the region to the classic mapArray path through the
runtime's re-entry thunk
