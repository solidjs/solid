---
"@solidjs/web": patch
"@solidjs/signals": patch
"solid-js": patch
---

`@solidjs/web/performance-tracks`: a `Propagation` track (replacing `Scheduler`)

Nothing re-renders in Solid, so React's component flame has no counterpart here; the picture a Solid developer wants is the graph a write travelled. The `Propagation` track paints each scheduler drain as a wave named by the writes that started it and what they reached (`count 0 → 1 — click on button#next · 5 runs, 1 unchanged`), and every run inside it — compute runs, creation runs, effect callbacks — at its own time, labelled by what made it run (`<TodoRow> › effect ← doubled`). The panel stacks the runs beneath their wave by time, so a wide flat wave is a coarse signal everyone depends on, a deep one a chain of memos, and a `warning` node with nothing after it the equality cutoff at work; a wave that mostly re-ran unchanged nodes is itself a `warning`. The wave span ignores `minMs`, so a fan-out of runs too small to paint still reads as its count.

Node labels fold framework structure into what the developer wrote: a flow control's own nodes (`<Show>`'s `condition value` / `condition` / `value`, a boundary's `children` / `boundary` / `value`, `<Switch>`'s `conditions`, `<Reveal>`'s `reveal order`) present as the tag, and a `primitive.local` name (the store convention, and what the compiler will emit for a composed primitive's internals) as the primitive — with the runtime's name kept in the span's `Node` property. Presentation only: the records are what the engine delivered.

Engine: `ChangeRecord` carries `nodeId` (the written signal's, or the changed memo's — the same id space as `RerunEvent.nodeId`), so a derived cause joins the run that produced it and repeated writes to one signal join each other after the record has left the process. `@solidjs/signals`' boundary nodes and `<Switch>`'s condition-builder memo are now named in observe builds (`children`, `boundary`, `value`, `reveal order`, `conditions`) where they read as anonymous `computed`s in owner paths before.
