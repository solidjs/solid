---
"@solidjs/signals": patch
---

A memo whose guess lane is corrected re-notifies the readers that derived from the lane's void value. A memo over an optimistic list's length (`items.length` after an accepted add replaced its placeholder) no longer keeps showing the lane's count when the truth's answer equals what the screen showed (#4971).
