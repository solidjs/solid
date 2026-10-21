---
"@solidjs/web": patch
---

A live server component's slot record that a commit changes now leaves in the same write as the holes that commit moved, with every arg current. Before, each arg of the occurrence re-sent the record as it updated, so the first copy went out alone with the other args still at their previous values, ahead of the hole. A client fill reading those args could show a state no commit had: the chat's pending message left the outbox before the thread showed its row.
