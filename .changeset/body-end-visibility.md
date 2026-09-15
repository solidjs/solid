---
"@solidjs/signals": patch
---

The window after an action body ends and its override is superseded by the committed truth (#3427) now reads like a landing supersession for every reader: a stale reader re-run by an unrelated write keeps displaying the override, a memo created mainline during the window is held with the transaction, and `isPending()` reads true while the truth differs from the override (`latest()` already answered the truth). The node carries no transaction stamp in that window — an override written inside an action never passes the adoption loop that stamps one — so `supersededRead` and the verdict now resolve the owning transaction through `_overrideOwner`. Also: a `latest()` / `isPending()` pull from mainline never enters a transaction (it is an observation); one did through the supersession path and captured the caller's synchronous block.
