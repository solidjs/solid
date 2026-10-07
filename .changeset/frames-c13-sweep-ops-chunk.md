---
"@solidjs/web": patch
---

frames: one server sweep lands as one frame (C13). The sink collects the `hole` / `attr` re-emissions one sweep produces and emits them as one `{ type: "ops", ops: [...] }` chunk on the stream face (one wire line) and one `sc:live` op of the same shape on the document face; a sweep that changes one binding emits that member alone, as before. The client maps the unit to one record map and applies it as one write — one hole pass, one `frame:applied` (the hole pass now announces once per flush, not once per hole). The document op log flattens a unit into its members (last value per hole). Additive wire (`FrameChunk` gains the `ops` member; RFC addendum in `frame-streams-rfc.md`).
