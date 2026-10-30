---
"@solidjs/signals": patch
---

An async memo that reads `latest()` no longer asks the frame's question twice when its flush parks. Its first pass belongs to the frame and asks that frame's question. When the flush parks, the memo re-derives in the verdict lane for the display-ahead view, and that re-derive used to discard the frame's flight, so the transaction's landing asked the same question again. The landing now adopts the frame's flight, whether it has already landed or is still in flight.
