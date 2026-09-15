---
"@solidjs/signals": patch
---

A memo or effect created from mainline code while a transaction holds a value it reads is now "born held" (A29, creation-time form): its creation pass derives from the transaction's staged world and is staged into that transaction — committed with it, and for an effect first run by its commit — instead of committing the held value into the mainline frame beside readers that show the committed one. The mainline block that created it is untouched: `enterStagedRead` no longer enters the transaction ambiently from creation code, so an unrelated write made after such a mount (a click that opens a panel while an action is in flight, then writes something else) is a mainline write again rather than being swallowed into the action. An untracked read of a born-held memo throws `NotReadyError` until the commit — it has no committed value to serve.
