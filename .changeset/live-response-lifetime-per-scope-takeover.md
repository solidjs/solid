---
"@solidjs/web": patch
"solid-js": patch
---

`live` claims the whole response and its post-hydration takeover fires per hydration scope.

- A live connection now lives as long as its response: an answer holding nested promises or async iterables (`{ meta, progress: gen }`) keeps the connection open until every one has settled. A body ending with deferreds still open is a death — the loop reconnects and re-yields the whole answer, fresh; one whose deferreds all settled is a completion. Nothing is added to the wire: the decoder counts what the codec's own close records leave open (`createJSONDeserializer`'s returned function gains an `open()` accessor beside `abort()`). Deferreds a reconnected-from death left open stay pending until the iteration ends for good, then fail.
- In process, `live()` brands the answer that is the source — the top-level iterable, or a function-valued answer (a component) as a whole. Sources nested in a value answer are not branded: they are bounded and end on their own, and a document render pumps them to their end as it does any streamed answer (their sharing between the serializer and a reading memo is the SSR fix in the companion changeset).
- The hydration takeover gate is keyed per snapshot scope: a live node in the shell reconnects when the root pass ends, a live node under a boundary when that boundary hydrates — no live node waits on another boundary or on page-wide hydration end. A later hydration pass (islands) arms its own gate.
- The takeover run tells the live answer the value the page was served with (`Symbol.for("solid.LiveResumeFrom")`), which the loop names as its first connection's `Last-Event-ID`; a takeover that finds the same value on the server yields nothing.
