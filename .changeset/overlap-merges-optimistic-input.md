---
"@solidjs/signals": patch
---

An optimistic change of an input no longer takes a slot away from another hold's guess. When an action guesses an input (a filter, a selection) and something derived from it carries a guess from another action that is still out (a pending row, a comment being sent), the two holds now merge, as they already did for a plain write of that input: the guess stays on screen and both reveal when the last of them settles. Before, the other guess left the screen as soon as the new answer loaded and came back only when its own request landed, or if the optimistic change reverted. To show the change at once, guess its effect too, in the same action.
