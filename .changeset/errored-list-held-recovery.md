---
"@solidjs/signals": patch
---

An `<Errored>` boundary over a list no longer reveals the list from before the error when the error's replacement lands held with an action (a guess on the errored store re-asked it): the error stays until that action's frame reveals, instead of showing the previous question's rows.
