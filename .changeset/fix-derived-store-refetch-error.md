---
"@solidjs/signals": patch
---

Fix a derived store (`createStore(fn)`) whose re-fetch rejects never reaching `Errored`: a render effect outside the flight's flush kept showing the last value instead of throwing the derive's error, for sync-to-async and async-to-async derives alike. Memos were unaffected.
