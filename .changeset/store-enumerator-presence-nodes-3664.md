---
"@solidjs/signals": patch
---

Enumerating a store object inside a computation (`Object.keys`, `for...in`, spread, `Object.entries`, `JSON.stringify`) no longer materializes a presence node per key (#3664). The descriptor trap's presence read (rc.9, for a lone `Object.getOwnPropertyDescriptor` inspection) also ran once per key of every enumeration, on top of the key-set node `ownKeys` had already subscribed the reader to — ~640 B and a graph node per key per object, 10x the memory of a 30-field row's reader versus rc.8. The trap now skips the presence read when the observer already holds the object's key-set node in the current pass; a lone descriptor read keeps its per-key precision and its reactivity to optimistic adds and deletes.
