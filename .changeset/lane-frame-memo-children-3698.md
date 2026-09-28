---
"@solidjs/signals": patch
---

A lane pass on a memo now parks the children it replaces as a lane frame, like the lane pass on an effect already did (#3662), instead of as zombies held for the action's commit. Those zombies made the memo a pending node of the action's transaction, so the next mainline write through it re-entered the hold and carried the write with it. Fixes a plain signal write staying pending (`latest()` true, `isPending()` true, the value unchanged) while an unrelated action stayed open, when a `<Show>` condition read that signal beside a visible optimistic value: the compiler emits `when={a() && !b()}` with a memo over `a()` inside the prop getter, so the condition memo owned a child memo that the optimistic lane pass parked (#3698).
