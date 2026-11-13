---
"@solidjs/signals": patch
---

fix(signals): a write is not held by an action whose hold waits only on its `refresh()` (#4828)

A memo that an action's hold had pending only on that action's `refresh()` pulled a later, unrelated write into the hold (switching a filter between two optimistic stores). The action's guess keeps its hold open until the refresh answers, so the switch, the other list's answer and the switch back all waited for it, and the refresh's landing then showed the other store's rows. A re-ask holds nothing new: the memo now leaves the hold and its next pass is the write's own frame.
