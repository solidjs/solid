---
"@solidjs/signals": patch
"solid-js": patch
---

A held derivation is not a proposal (#3612). A mainline write to a writable memo (`createSignal(fn)`) or function-form store (`createStore(fn)`) whose staging is a pass result held by another transaction no longer suppresses that transaction's re-derivation: the write still joins the transaction (A34), and the derivation re-runs under the hold with the written value as `prev`. Same-frame "manual write wins" (#2692) and last-write-wins for writes made inside the transaction are unchanged.
