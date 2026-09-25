---
"@solidjs/web": patch
"@solidjs/signals": patch
---

`dynamic`: a live server component's reconnect after its source switched arguments keeps the mounted instance at the standing address. The binding equals-gate read "the address that is not the delivered one" as incoming, but the memo holds its first (kept) resolution forever, so the reconnect's re-yield of the standing binding swung the frame back to the document's address and the reconnect's render landed where nothing was bound. The gate now reads its arguments as `(prev, next)` and delivers `next`'s address when it is not the one showing.

Signals: the lane landing in `asyncWrite` now calls a user `equals` comparator as `(prev, next)`, the order every other commit path uses (it passed `(next, prev)`).
