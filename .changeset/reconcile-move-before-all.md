---
"@solidjs/web": patch
---

List reconciliation moves every connected node with `Element.moveBefore()` where the browser has it, not only the node holding focus, and no longer uses `replaceChild()` there. Moved rows stay connected, so focus and other node state survive any reorder, and a reorder places nodes instead of detaching and reattaching them: dbmon's 1,000-row sort drops from ~2.0 ms to ~0.75 ms, and shuffles and reverses get 3–7% faster. The per-pass `document.activeElement` read is gone. New nodes and browsers without `moveBefore()` keep `insertBefore()` as before.
