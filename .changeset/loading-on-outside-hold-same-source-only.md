---
"@solidjs/signals": patch
"solid-js": patch
---

The DEV `LOADING_ON_OUTSIDE_HOLD` diagnostic now reports only the deterministic shape: `on` re-armed a Loading boundary while the very async source it is waiting on is also read by a live reader outside it, so the frame is held on that source and the fallback can never be seen (`data.source` names it; the fix is to move the outside read under the boundary). The after-the-fact report — the frame held by the write's action or by other pending data past the content's landing, so the staged fallback was cleared before display — is removed: that is a race the developer does not control, a fallback that loses it is a legitimate outcome, and the engine cannot tell an action that awaited exactly this data from one that awaited something slower.
