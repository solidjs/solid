---
"@solidjs/signals": patch
---

Suspend stale readers on an uninitialized async memo held by another
transition. A render effect that switched onto an async memo still in flight
under a *different* transaction took the "show the committed value, don't
entangle" path — but an uninitialized memo has no committed value, so the
reader was served `undefined` as if settled and left stamped into neither
transaction. It never re-ran when either landed and stuck on its old value
(e.g. a globally cached async memo shared by two inputs updated 300ms apart).
Such reads now throw NotReady like the equivalent firewall-backed read already
did, registering the reader with the active transaction so the two
transactions merge and reveal together. Regression from the
`needsPendingCommit` gate in 7d4d0c3a (beta.11), which removed the accidental
pending-node stamp that used to entangle the reader.
