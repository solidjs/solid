---
"@solidjs/signals": patch
---

Fix an optimistic override superseded by its source's landing leaking the landed truth into a later action's lane frame (#3548). A lane pass composes the frame it applies ahead of the commit, so a superseded node now serves it the displayed override — A18 (c): the screen keeps the override until the owning transaction commits — and the reader is recorded for replay at that commit, since the superseded drop notifies nobody. Before, a fresh write's lane reaching a reader shared with the superseded node (two filtered keyed `<For>` lists over one optimistic store) re-derived one list from the truth while its neighbour still displayed the override, rendering the same row in two lanes.
